// 平台契约测试：覆盖 GitHub/Gitea 协议差异和打标的事件边界，不访问真实平台。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createAPI } from './forge-api.mjs'
import { planVersion, runVersionTag } from './version-tag.mjs'

// mockAPI 记录请求，不保存或输出认证信息。
function mockAPI(platform, reply) {
  const calls = []
  const api = createAPI({ platform, server: 'https://gitea.invalid', apiURL: 'https://github.invalid/api/v3', repository: 'org/repo', token: 'synthetic-secret',
    fetcher: async (url, options) => {
      calls.push({ url, method: options.method, body: options.body ? JSON.parse(options.body) : undefined })
      assert.equal(options.redirect, 'error')
      const body = reply(url, options)
      return { ok: body !== null, status: body === null ? 404 : 200, json: async () => body }
    } })
  return { api, calls }
}

test('GitHub 使用 per_page、merged_at 和双阶段附注标签 API', async () => {
  const { api, calls } = mockAPI('github', url => {
    if (url.includes('/pulls?')) return url.includes('page=1') ? Array(50).fill({ merged_at: '2026-01-01', merge_commit_sha: 'sha', title: 'fix: 修复' }) : []
    if (url.endsWith('/git/ref/tags/v1.0.0')) return { object: { type: 'tag', sha: 'object' } }
    if (url.endsWith('/git/tags/object')) return { object: { type: 'commit', sha: 'sha' } }
    return { sha: 'object' }
  })
  const pulls = await api.listPulls()
  assert.equal(pulls.length, 50)
  assert.match(calls[0].url, /sort=updated&direction=desc&per_page=50&page=1$/)
  assert.equal((await planVersion({ listPulls: async () => [pulls[0]] }, { baseTag: 'v0.0.0', commits: ['sha'], messages: ['chore: 合并'] })).level, 'patch')
  assert.deepEqual(await api.getTag('v1.0.0'), { commit: { sha: 'sha' } })
  await api.createTag('v1.0.0', 'sha', '发布')
  assert.deepEqual(calls.at(-2).body, { tag: 'v1.0.0', message: '发布', object: 'sha', type: 'commit' })
  assert.deepEqual(calls.at(-1).body, { ref: 'refs/tags/v1.0.0', sha: 'object' })
})

test('Gitea 保留 limit 和原生附注标签端点', async () => {
  const { api, calls } = mockAPI('gitea', url => url.includes('/pulls?') ? [] : { commit: { sha: 'sha' } })
  await api.listPulls()
  assert.match(calls[0].url, /api\/v1\/repos\/org\/repo\/pulls\?.*limit=50/)
  await api.createTag('v1.0.0', 'sha', '发布')
  assert.deepEqual(calls.at(-1).body, { tag_name: 'v1.0.0', target: 'sha', message: '发布' })
})

test('不存在的 GitHub 标签返回空值，网络错误隐藏详情', async () => {
  const { api } = mockAPI('github', () => null)
  assert.equal(await api.getTag('v1.0.0'), null)
  const broken = createAPI({ repository: 'org/repo', token: 'synthetic-secret', fetcher: async () => { throw new Error('synthetic-secret') } })
  await assert.rejects(() => broken.listPulls(), error => !error.message.includes('synthetic-secret'))
})

test('PR 事件即使伪装发布分支也不能打标', async () => {
  await assert.rejects(() => runVersionTag({ env: { GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'pull_request' } }), /仅允许/)
})

test('耗时 PR 解析后再次检查主线，拒绝过期作业', async () => {
  let fetches = 0, created = 0
  const runGit = args => {
    if (args[0] === 'fetch') { fetches++; return '' }
    if (['status', 'tag'].includes(args[0])) return ''
    if (args[1] === 'refs/remotes/origin/main') return fetches > 1 ? 'new' : 'sha'
    return 'sha'
  }
  await assert.rejects(() => runVersionTag({ runGit, env: { GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'push' },
    state: () => ({ baseTag: 'v0.0.0', commits: ['sha'], messages: ['fix: 修复'] }),
    api: { listPulls: async () => [], getTag: async () => null, createTag: async () => { created++ } } }), /main 已更新/)
  assert.equal(created, 0)
})
