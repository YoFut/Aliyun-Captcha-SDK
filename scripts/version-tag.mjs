// CI 工具：CI 门禁通过后为 main 自动创建不可变 annotated tag；MAJOR 需精确 SHA 人工确认。
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { createAPI, readEvent } from './forge-api.mjs'
import { git, getVersionState, selectLevel, bumpVersion, STABLE_TAG } from './version.mjs'

const priority = { none: 0, patch: 1, minor: 2, major: 3 }

// planVersion 按 PR 标签覆盖对应提交，未覆盖提交仍参与推导，避免一个 none 标签吞掉整个发布范围。
export async function planVersion(api, state = getVersionState()) {
  const messages = new Map(state.commits.map((sha, index) => [sha, state.messages[index]]))
  let level = 'none'
  const evidence = []
  const pulls = await api.listPulls()
  // 先处理带覆盖意图的 PR；重叠覆盖存在歧义时阻止发布。
  const covered = new Set()
  const relevant = pulls.filter(pull => (pull.merged || pull.merged_at) && messages.has(pull.merge_commit_sha))
  relevant.sort((left, right) => Number((right.labels ?? []).some(label => label.name.startsWith('semver:'))) - Number((left.labels ?? []).some(label => label.name.startsWith('semver:'))))
  for (const pull of relevant) {
    const labels = (pull.labels ?? []).map(label => label.name)
    const override = labels.some(label => label.startsWith('semver:'))
    if (!override && covered.has(pull.merge_commit_sha)) continue
    const commits = override ? await api.list(`/pulls/${pull.number}/commits`) : []
    const affected = [pull.merge_commit_sha, ...commits.map(commit => commit.sha)].filter(sha => messages.has(sha))
    if (override && affected.some(sha => covered.has(sha))) throw new Error('PR semver 覆盖范围重叠，请消除嵌套覆盖歧义')
    const value = selectLevel([pull.title ?? '', pull.body ?? '', ...affected.map(sha => messages.get(sha))], labels)
    if (override) for (const sha of affected) covered.add(sha)
    if (priority[value] > priority[level]) level = value
    evidence.push({ pr: pull.number, level: value, override })
  }
  const remainder = selectLevel([...messages].filter(([sha]) => !covered.has(sha)).map(([, message]) => message))
  if (priority[remainder] > priority[level]) level = remainder
  return { baseTag: state.baseTag, tag: bumpVersion(state.baseTag, level), level, evidence }
}

// runVersionTag 重读远端状态，拒绝过期 main 作业，且不覆盖已有 tag。
export async function runVersionTag({ api, runGit = git, state = getVersionState, env = process.env, event = readEvent } = {}) {
  const branch = env.VERSION_BRANCH || 'main'
  const ref = env.VERSION_REF || env.GITEA_REF || env.GITHUB_REF
  const eventName = env.VERSION_EVENT_NAME || env.GITEA_EVENT_NAME || env.GITHUB_EVENT_NAME
  if (ref !== `refs/heads/${branch}` || !['push', 'workflow_dispatch'].includes(eventName)) throw new Error('正式 tag 仅允许在发布分支的 push 或人工流程创建')
  api ??= createAPI()
  const remote = env.VERSION_REMOTE ?? 'origin'
  const refresh = () => {
    runGit(['fetch', remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`, '--tags'])
    if (runGit(['rev-parse', `refs/remotes/${remote}/${branch}`]) !== runGit(['rev-parse', 'HEAD'])) throw new Error('main 已更新，请由最新提交的 CI 生成版本')
  }
  refresh()
  const sha = runGit(['rev-parse', 'HEAD'])
  if (runGit(['status', '--porcelain', '--untracked-files=normal'])) throw new Error('自动打标要求工作区干净')
  const exactTags = runGit(['tag', '--points-at', sha]).split('\n').filter(tag => STABLE_TAG.test(tag))
  if (exactTags.length) {
    for (const tag of exactTags) if (runGit(['cat-file', '-t', `refs/tags/${tag}`]) !== 'tag') throw new Error('当前提交存在非 annotated 正式 tag')
    console.log(`该提交已有正式 tag：${exactTags.join('、')}，无需重复创建`)
    return
  }
  const plan = await planVersion(api, state())
  console.log(JSON.stringify(plan, null, 2))
  if (plan.level === 'none') { console.log('没有需要发布的语义变更'); return }
  if (plan.level === 'major') {
    const payload = event()
    if (eventName !== 'workflow_dispatch' || payload.inputs?.approved_sha !== sha) {
      console.log(`MAJOR 升级等待确认：请在 main 手动启动 CI，approved_sha 填入 ${sha}`)
      return
    }
  }
  const existing = await api.getTag(plan.tag)
  if (existing) {
    if (existing.commit?.sha !== sha) throw new Error('目标 tag 已指向其他提交，禁止覆盖')
    runGit(['fetch', remote, `refs/tags/${plan.tag}:refs/tags/${plan.tag}`])
    if (runGit(['cat-file', '-t', `refs/tags/${plan.tag}`]) !== 'tag') throw new Error('已有正式 tag 必须为 annotated tag')
    return
  }
  refresh()
  try {
    await api.createTag(plan.tag, sha, `release: ${plan.tag}\n\n提交：${sha}\n语义级别：${plan.level}`)
  } catch (error) {
    // 并发创建的最终仲裁由远端唯一 tag 完成；同提交重试可安全成功。
    const raced = await api.getTag(plan.tag)
    if (raced?.commit?.sha !== sha) throw error
  }
  runGit(['fetch', remote, `refs/tags/${plan.tag}:refs/tags/${plan.tag}`])
  if (runGit(['cat-file', '-t', `refs/tags/${plan.tag}`]) !== 'tag' || runGit(['rev-parse', `${plan.tag}^{commit}`]) !== sha) throw new Error('远端 tag 类型或提交校验失败')
  console.log(`正式 tag 已创建：${plan.tag}；Release 仍需人工启动`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runVersionTag().catch(error => { console.error(`版本流程失败：${error.message}`); process.exitCode = 1 })
}
