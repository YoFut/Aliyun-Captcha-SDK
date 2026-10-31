// 契约测试：使用隔离 Git 仓库验证语义版本、历史标签、浅克隆及 PR 覆盖，不写真实远端。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { inferLevel, bumpVersion, selectLevel, resolveVersion, getVersionState } from './version.mjs'
import { planVersion, runVersionTag } from './version-tag.mjs'
import { createAPI } from './forge-api.mjs'

// repository 为每个用例创建独立仓库，清理由固定的临时路径执行。
function repository(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'captcha-version-'))
  t.after(() => {
    if (resolve(dirname(cwd)) !== resolve(tmpdir()) || !basename(cwd).startsWith('captcha-version-')) throw new Error('测试清理路径越界')
    rmSync(cwd, { recursive: true, force: true })
  })
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init', '-b', 'main')
  git('config', 'user.name', '版本契约测试')
  git('config', 'user.email', 'version-test@example.invalid')
  git('config', 'commit.gpgsign', 'false')
  git('config', 'tag.gpgsign', 'false')
  const commit = message => { git('commit', '--allow-empty', '-m', message); return git('rev-parse', 'HEAD') }
  return { cwd, git, commit }
}

test('语义升级不使用提交数，兼容合并标题和破坏性正文', () => {
  assert.equal(inferLevel(['docs: 文档', 'fix(web): 修复']), 'patch')
  assert.equal(inferLevel(['Merge(#66): feat(web): 新功能', 'fix: 修复']), 'minor')
  assert.equal(inferLevel(['refactor(core)!: 改变契约']), 'major')
  assert.equal(inferLevel(['chore: 更新\n\nBREAKING CHANGE: 契约改变']), 'major')
  assert.equal(inferLevel(['docs: 文档', 'perf: 内部优化']), 'none')
  assert.equal(inferLevel(['docs: 介绍提交格式\n\n例如 feat: 新功能', '说明 feat: 不应作为提交类型']), 'none')
  assert.equal(bumpVersion('v0.1.161', 'patch'), 'v0.1.162')
  assert.equal(bumpVersion('v0.1.161', 'minor'), 'v0.2.0')
  assert.equal(bumpVersion('v0.1.161', 'major'), 'v1.0.0')
  assert.equal(selectLevel(['feat: 功能'], ['semver:none']), 'none')
  assert.throws(() => selectLevel([], ['semver:none', 'semver:patch']), /冲突/)
  assert.throws(() => selectLevel([], ['semver:invalid']), /无效/)
})

test('无 tag、精确 tag、dirty、detached 和历史 release 均有确定身份', t => {
  const repo = repository(t)
  repo.commit('fix: 初始修复')
  assert.match(resolveVersion({ cwd: repo.cwd }).version, /^v0\.0\.1-dev\.1\+sha\./)
  repo.git('tag', '-a', 'v0.1.161', '-m', '历史正式版本')
  const stable = resolveVersion({ cwd: repo.cwd, mode: 'release', tag: 'v0.1.161' })
  assert.equal(stable.version, 'v0.1.161')
  assert.equal(stable.channel, 'release')
  assert.equal(stable.baseTag, 'v0.1.161')
  assert.equal(stable.distance, 0)
  assert.match(resolveVersion({ cwd: repo.cwd }).version, /^v0\.1\.161-dev\.0\+/)
  repo.commit('feat: 新功能')
  assert.equal(getVersionState(repo.cwd).baseTag, 'v0.1.161')
  assert.match(resolveVersion({ cwd: repo.cwd }).version, /^v0\.2\.0-dev\.1\+/)
  repo.git('tag', '-a', 'v0.2.0', '-m', '后续正式版本')
  assert.throws(() => resolveVersion({ cwd: repo.cwd, mode: 'release', tag: 'v0.1.161' }), /不一致/)
  repo.git('checkout', '--detach', 'v0.1.161')
  assert.equal(resolveVersion({ cwd: repo.cwd, mode: 'release', tag: 'v0.1.161' }).commit, stable.commit)
  assert.equal(resolveVersion({ cwd: repo.cwd, mode: 'release', tag: 'v0.1.161' }).baseTag, stable.baseTag)
  writeFileSync(join(repo.cwd, 'dirty.txt'), '未提交修改')
  assert.match(resolveVersion({ cwd: repo.cwd }).version, /\.dirty$/)
  assert.throws(() => resolveVersion({ cwd: repo.cwd, mode: 'release', tag: 'v0.1.161' }), /干净/)
})

test('main 最新正式基线优先于功能分支最近祖先 tag', t => {
  const repo = repository(t)
  repo.commit('chore: 初始化')
  repo.git('tag', '-a', 'v0.1.2', '-m', '旧版本')
  repo.git('branch', 'dev')
  repo.commit('chore: 合并主线')
  repo.git('tag', '-a', 'v0.1.161', '-m', '现有版本')
  repo.git('checkout', 'dev')
  repo.commit('fix: 开发修复')
  const state = getVersionState(repo.cwd)
  assert.equal(state.baseTag, 'v0.1.161')
  assert.equal(state.distance, 1)
  assert.match(resolveVersion({ cwd: repo.cwd }).version, /^v0\.1\.162-dev\.1/)
})

test('拒绝轻量正式 tag、浅历史和伪造构建模式', t => {
  const repo = repository(t)
  repo.commit('chore: 初始化')
  repo.git('tag', 'v0.1.0')
  assert.throws(() => resolveVersion({ cwd: repo.cwd, mode: 'release', tag: 'v0.1.0' }), /annotated/)
  assert.throws(() => resolveVersion({ cwd: repo.cwd, mode: 'production' }), /模式/)
  const clone = join(repo.cwd, 'shallow')
  repo.git('clone', '--depth', '1', pathToFileURL(repo.cwd).href, clone)
  assert.throws(() => resolveVersion({ cwd: clone }), /完整历史/)
})

test('PR none 只覆盖对应提交，其他修复仍产生 PATCH', async () => {
  const state = { baseTag: 'v0.1.161', commits: ['feature', 'fix'], messages: ['feat: 内部工具', 'fix: 实际修复'] }
  const api = { listPulls: async () => [{ number: 1, merged: true, merge_commit_sha: 'feature', title: 'feat: 内部工具', labels: [{ name: 'semver:none' }] }], list: async () => [] }
  const plan = await planVersion(api, state)
  assert.equal(plan.tag, 'v0.1.162')
  assert.equal(plan.level, 'patch')
})

test('嵌套 PR 的明确覆盖抑制已覆盖子提交的推导，重叠覆盖拒绝', async () => {
  const state = { baseTag: 'v1.0.0', commits: ['outer', 'inner'], messages: ['Merge: dev -> main', 'feat: 内部功能'] }
  const pulls = [
    { number: 1, merged: true, merge_commit_sha: 'inner', title: 'feat: 内部功能', labels: [] },
    { number: 2, merged: true, merge_commit_sha: 'outer', title: 'Merge: dev -> main', labels: [{ name: 'semver:none' }] },
  ]
  const api = { listPulls: async () => pulls, list: async () => [{ sha: 'inner' }] }
  assert.equal((await planVersion(api, state)).level, 'none')
  pulls[0].labels = [{ name: 'semver:patch' }]
  await assert.rejects(() => planVersion(api, state), /重叠/)
})

test('API 分页完整且错误不泄露凭证或响应正文', async () => {
  const api = createAPI({ platform: 'gitea', server: 'https://gitea.invalid', repository: 'org/repo', token: 'synthetic-secret', fetcher: async url => ({ ok: true, status: 200, json: async () => url.includes('page=1') ? Array(50).fill({ number: 1 }) : [{ number: 51 }] }) })
  assert.equal((await api.list('/pulls?state=closed')).length, 51)
  const denied = createAPI({ server: 'https://gitea.invalid', repository: 'org/repo', token: 'synthetic-secret', fetcher: async () => ({ ok: false, status: 403 }) })
  await assert.rejects(() => denied.request('/tags'), error => !error.message.includes('synthetic-secret') && /403/.test(error.message))
})

// tagFixture 隔离远端 API 和 Git 命令，用于验证创建重试及人工确认边界。
function tagFixture({ message = 'fix: 修复', existing = null, race = false, remoteSHA = 'sha', approved = '' } = {}) {
  let created = 0, stored = existing
  const api = {
    listPulls: async () => [],
    getTag: async () => stored,
    createTag: async () => {
        created++
        stored = { commit: { sha: 'sha' } }
        if (race) throw new Error('模拟另一作业已创建同一 tag')
        return stored
    },
  }
  const runGit = args => {
    if (['fetch', 'tag', 'status'].includes(args[0])) return ''
    if (args[0] === 'cat-file') return 'tag'
    if (args[1] === 'refs/remotes/origin/main') return remoteSHA
    return 'sha'
  }
  return {
    input: { api, runGit, state: () => ({ baseTag: 'v1.0.0', commits: ['sha'], messages: [message] }), env: { GITEA_REF: 'refs/heads/main', GITEA_EVENT_NAME: approved ? 'workflow_dispatch' : 'push' }, event: () => ({ inputs: { approved_sha: approved } }) },
    created: () => created,
  }
}

test('tag 创建重试、并发同 SHA 和冲突提交均遵守不可变规则', async () => {
  const first = tagFixture()
  await runVersionTag(first.input)
  await runVersionTag(first.input)
  assert.equal(first.created(), 1)
  const race = tagFixture({ race: true })
  await runVersionTag(race.input)
  assert.equal(race.created(), 1)
  const conflict = tagFixture({ existing: { commit: { sha: 'other' } } })
  await assert.rejects(() => runVersionTag(conflict.input), /禁止覆盖/)
  const stale = tagFixture({ remoteSHA: 'newer' })
  await assert.rejects(() => runVersionTag(stale.input), /main 已更新/)
  assert.equal(stale.created(), 0)
})

test('MAJOR 仅接受当前 SHA 的人工确认，none 不创建 tag', async () => {
  for (const approved of ['', 'older', 'sha']) {
    const fixture = tagFixture({ message: 'feat!: 破坏性变更', approved })
    await runVersionTag(fixture.input)
    assert.equal(fixture.created(), approved === 'sha' ? 1 : 0)
  }
  const none = tagFixture({ message: 'docs: 文档' })
  await runVersionTag(none.input)
  assert.equal(none.created(), 0)
})
