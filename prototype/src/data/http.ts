import { getAccessToken } from './oidc'

/**
 * 门户 HTTP 传输层：base URL、Bearer 注入、401 会话事件与错误体归一的
 * 唯一属主。六个 API client（controlPlane / aiData / dataServices / mpi /
 * lineage / analytics）只剩端点声明；错误体统一解析 message/detail/code
 * （此前各 client 口径不一：detail、code 或都不解析），页面经
 * PortalHttpError 读取 status/code，不再匹配错误文案。
 */
export const API_BASE_URL = (import.meta.env.VITE_DATAOS_API_BASE_URL ?? '/api').replace(/\/$/, '')

export class PortalHttpError extends Error {
  readonly status: number
  readonly code: string

  constructor(message: string, status: number, code = '') {
    super(message)
    this.name = 'PortalHttpError'
    this.status = status
    this.code = code
  }
}

export async function portalFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (!headers.has('Accept')) headers.set('Accept', 'application/json')
  const token = getAccessToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers })
  if (response.status === 401 && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('dataos:auth-required'))
  }
  return response
}

/** 非 2xx 时抛统一错误（`if (!response.ok) await throwHttpError(...)` 风格用）。 */
export async function throwHttpError(response: Response, prefix: string): Promise<never> {
  let detail = ''
  let code = ''
  try {
    const payload = await response.json() as { message?: string; detail?: string; code?: string }
    detail = payload.message ?? payload.detail ?? ''
    code = payload.code ?? ''
  } catch {
    // 上游未返回 JSON 时仅保留 HTTP 状态。
  }
  throw new PortalHttpError(`${prefix}${detail ? `：${detail}` : ''}（HTTP ${response.status}）`, response.status, code)
}

export async function parseJsonOrThrow(response: Response, prefix: string): Promise<unknown> {
  if (!response.ok) await throwHttpError(response, prefix)
  return response.json()
}

/** GET + 统一错误归一（只读端点的通用形态）。 */
export async function fetchJson<T>(path: string, signal: AbortSignal | undefined, prefix: string): Promise<T> {
  return parseJsonOrThrow(await portalFetch(path, { signal }), prefix) as Promise<T>
}
