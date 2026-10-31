// 构建工具：统一解析 Git 语义版本；用法：node scripts/version.mjs [--mode dev|release] [--tag vX.Y.Z]。
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

export const ROOT = fileURLToPath(new URL('../', import.meta.url))
export const STABLE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

// git 使用参数数组执行，避免分支名、提交信息被 shell 展开。
export function git(args, cwd = ROOT) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

// inferLevel 识别合并标题中的 Conventional Commit 以及正文中的破坏性声明。
export function inferLevel(messages) {
  let level = 'none'
  for (const message of messages) {
    const header = message.split('\n', 1)[0].trim().replace(/^(?:Merge(?:\([^)]*\))?:\s*)+/i, '')
    if (/^BREAKING[ -]CHANGE:\s*\S/m.test(message) || /^[a-z][a-z0-9-]*(?:\([^\n)]+\))?!:/.test(header)) return 'major'
    if (/^feat(?:\([^\n)]+\))?:/.test(header)) level = 'minor'
    else if (level === 'none' && /^fix(?:\([^\n)]+\))?:/.test(header)) level = 'patch'
  }
  return level
}

// bumpVersion 只按语义级别升级，提交数从不参与正式 PATCH 计算。
export function bumpVersion(base, level) {
  if (!STABLE_TAG.test(base)) throw new Error('正式版本格式无效')
  const [major, minor, patch] = base.slice(1).split('.').map(Number)
  if (level === 'major') return `v${major + 1}.0.0`
  if (level === 'minor') return `v${major}.${minor + 1}.0`
  if (level === 'patch') return `v${major}.${minor}.${patch + 1}`
  if (level === 'none') return base
  throw new Error('版本升级级别无效')
}

// selectLevel 同一 PR 只能有一个 semver 标签；明确标签覆盖其推导结果。
export function selectLevel(messages, labels = []) {
  if (labels.some(label => label.startsWith('semver:') && !/^semver:(major|minor|patch|none)$/.test(label))) throw new Error('存在无效的 semver 标签')
  const levels = [...new Set(labels.filter(label => /^semver:(major|minor|patch|none)$/.test(label)).map(label => label.slice(7)))]
  if (levels.length > 1) throw new Error('同一 PR 存在冲突的 semver 标签')
  return levels[0] ?? inferLevel(messages)
}

// getVersionState 以 main 正式标签为基线，支持 dev 尚未包含最近 main 合并节点的历史。
export function getVersionState(cwd = ROOT) {
  if (git(['rev-parse', '--is-shallow-repository'], cwd) === 'true') throw new Error('版本解析需要完整历史，请 git fetch --unshallow --tags')
  const branch = process.env.VERSION_BRANCH || 'main'
  const remote = process.env.VERSION_REMOTE || 'origin'
  const refs = [`refs/remotes/${remote}/${branch}`, `refs/heads/${branch}`]
  const mainRef = refs.find(ref => { try { git(['rev-parse', '--verify', ref], cwd); return true } catch { return false } })
  const tags = git(['tag', ...(mainRef ? ['--merged', mainRef] : ['--merged', 'HEAD']), '--sort=-version:refname'], cwd).split('\n').filter(tag => STABLE_TAG.test(tag))
  const baseTag = tags[0] ?? 'v0.0.0'
  const range = tags.length ? `${baseTag}..HEAD` : 'HEAD'
  const records = git(['log', '--format=%H%x00%B%x00', range], cwd).split('\0')
  const commits = [], messages = []
  for (let index = 0; index + 1 < records.length; index += 2) {
    commits.push(records[index].trim())
    messages.push(records[index + 1].trim())
  }
  return { baseTag, commits, messages, distance: commits.length, level: inferLevel(messages) }
}

// resolveVersion 正式构建必须显式指定干净工作区上的 annotated tag，开发构建始终带 dev 后缀。
export function resolveVersion({ mode = 'dev', tag, cwd = ROOT } = {}) {
  if (!['dev', 'release'].includes(mode)) throw new Error('构建模式必须为 dev 或 release')
  const commit = git(['rev-parse', 'HEAD'], cwd)
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
  const dirty = Boolean(git(['status', '--porcelain', '--untracked-files=normal'], cwd))
  const state = getVersionState(cwd)
  const epoch = process.env.SOURCE_DATE_EPOCH ?? git(['show', '-s', '--format=%ct', 'HEAD'], cwd)
  if (!/^\d+$/.test(epoch)) throw new Error('SOURCE_DATE_EPOCH 必须为 Unix 秒数')
  const buildTime = new Date(Number(epoch) * 1000).toISOString()
  let version
  if (mode === 'release') {
    if (!tag || !STABLE_TAG.test(tag)) throw new Error('正式构建必须指定 --tag vMAJOR.MINOR.PATCH')
    if (dirty) throw new Error('正式构建要求工作区干净')
    if (git(['cat-file', '-t', `refs/tags/${tag}`], cwd) !== 'tag') throw new Error('正式构建要求 annotated tag')
    if (git(['rev-parse', `${tag}^{commit}`], cwd) !== commit) throw new Error('指定 tag 与当前提交不一致')
    version = tag
  } else {
    const candidate = bumpVersion(state.baseTag, state.level)
    version = `${candidate}-dev.${state.distance}+sha.${commit.slice(0, 7)}${dirty ? '.dirty' : ''}`
  }
  return { version, channel: mode, commit, branch, dirty, buildTime, tag: mode === 'release' ? tag : '', baseTag: mode === 'release' ? tag : state.baseTag, distance: mode === 'release' ? 0 : state.distance }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2)
    const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined
    console.log(JSON.stringify(resolveVersion({ mode: option('--mode') ?? 'dev', tag: option('--tag') }), null, 2))
  } catch (error) { console.error(`版本解析失败：${error.message}`); process.exitCode = 1 }
}
