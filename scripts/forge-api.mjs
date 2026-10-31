// 平台适配：以统一接口访问 GitHub/Gitea，不记录凭证、响应正文或网络错误详情。
import { readFileSync } from 'node:fs'

// createAPI 将分页、PR 和附注标签差异限制在平台适配层。
export function createAPI({
  platform = process.env.VERSION_PLATFORM || (process.env.GITEA_SERVER_URL ? 'gitea' : 'github'),
  server = process.env.GITEA_SERVER_URL,
  apiURL = process.env.GITHUB_API_URL || 'https://api.github.com',
  repository = process.env.VERSION_REPOSITORY || process.env.GITEA_REPOSITORY || process.env.GITHUB_REPOSITORY,
  token = process.env.VERSION_BOT_TOKEN || process.env.GITEA_TOKEN || process.env.GITHUB_TOKEN,
  fetcher = fetch,
} = {}) {
  if (!['github', 'gitea'].includes(platform)) throw new Error('版本平台必须为 github 或 gitea')
  if (!/^[^/]+\/[^/]+$/.test(repository ?? '') || !token || (platform === 'gitea' && !server)) throw new Error('缺少平台地址、仓库名或受限凭证')
  const base = platform === 'gitea' ? `${server.replace(/\/$/, '')}/api/v1` : apiURL.replace(/\/$/, '')
  const root = `${base}/repos/${repository.split('/').map(encodeURIComponent).join('/')}`
  // request 只报告 HTTP 状态，拒绝携带认证头跟随重定向。
  async function request(path, { method = 'GET', body, allow404 = false } = {}) {
    let response
    try {
      response = await fetcher(`${root}${path}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(30000),
        headers: { Authorization: `${platform === 'github' ? 'Bearer' : 'token'} ${token}`,
          ...(platform === 'github' ? { Accept: 'application/vnd.github+json' } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      })
    } catch { throw new Error('版本平台 API 网络请求失败') }
    if (allow404 && response.status === 404) return null
    if (!response.ok) throw new Error(`版本平台 API ${method} ${path.split('?')[0]} 失败：HTTP ${response.status}`)
    return response.status === 204 ? null : response.json()
  }
  // list 使用平台分页参数，完整读取历史 PR 和提交。
  async function list(path) {
    const items = []
    for (let page = 1; ; page++) {
      const batch = await request(`${path}${path.includes('?') ? '&' : '?'}${platform === 'github' ? 'per_page' : 'limit'}=50&page=${page}`)
      if (!Array.isArray(batch)) throw new Error('平台分页接口返回格式无效')
      items.push(...batch)
      if (batch.length < 50) return items
    }
  }
  const listPulls = () => list(`/pulls?state=closed&sort=${platform === 'github' ? 'updated' : 'recentclose'}&direction=desc`)
  // getTag 统一返回最终提交；GitHub 需从引用剥离附注标签对象。
  async function getTag(tag) {
    if (platform === 'gitea') return request(`/tags/${encodeURIComponent(tag)}`, { allow404: true })
    const ref = await request(`/git/ref/tags/${encodeURIComponent(tag)}`, { allow404: true })
    if (!ref) return null
    let object = ref.object
    for (let depth = 0; object?.type === 'tag'; depth++) {
      if (depth >= 16) throw new Error('附注标签嵌套过深')
      object = (await request(`/git/tags/${object.sha}`)).object
    }
    if (object?.type !== 'commit') throw new Error('正式标签没有指向提交')
    return { commit: { sha: object.sha } }
  }
  // createTag 只创建新引用；不调用更新引用或 force 接口。
  async function createTag(tag, sha, message) {
    if (platform === 'gitea') return request('/tags', { method: 'POST', body: { tag_name: tag, target: sha, message } })
    const object = await request('/git/tags', { method: 'POST', body: { tag, message, object: sha, type: 'commit' } })
    return request('/git/refs', { method: 'POST', body: { ref: `refs/tags/${tag}`, sha: object.sha } })
  }
  return { request, list, listPulls, getTag, createTag }
}

// readEvent 读取工作流提供的事件文件；不打印输入内容。
export function readEvent() {
  const path = process.env.VERSION_EVENT_PATH || process.env.GITEA_EVENT_PATH || process.env.GITHUB_EVENT_PATH
  return path ? JSON.parse(readFileSync(path, 'utf8')) : {}
}
