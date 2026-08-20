import { getAccessToken } from './oidc'

/**
 * 嵌入式分析 API 客户端（控制面 BFF → Superset 访客令牌，见 G4 方案）。
 * 仪表盘以 BFF 白名单为准；嵌入 origin 是门户 nginx 的专用监听端口
 * （默认同主机 18084，可用 VITE_DATAOS_SUPERSET_EMBED_ORIGIN 覆盖）。
 */

const API_BASE_URL = (import.meta.env.VITE_DATAOS_API_BASE_URL ?? '/api').replace(/\/$/, '')

export interface EmbeddableDashboard {
  id: string
  title: string
  embeddedUuid: string
}

export interface GuestTokenResponse {
  token: string
  dashboardId: string
  expiresInSeconds: number
}

export class AnalyticsError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'AnalyticsError'
    this.status = status
  }
}

async function analyticsFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (!headers.has('Accept')) headers.set('Accept', 'application/json')
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const token = getAccessToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers })
  if (response.status === 401 && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('dataos:auth-required'))
  }
  return response
}

async function parseOrThrow(response: Response, prefix: string): Promise<unknown> {
  if (!response.ok) {
    let detail = ''
    try {
      const payload = await response.json() as { message?: string }
      detail = payload.message ?? ''
    } catch {
      // 非 JSON 错误体时仅保留 HTTP 状态。
    }
    throw new AnalyticsError(`${prefix}${detail ? `：${detail}` : ''}（HTTP ${response.status}）`, response.status)
  }
  return response.json()
}

export async function fetchEmbeddableDashboards(signal?: AbortSignal): Promise<EmbeddableDashboard[]> {
  const payload = await parseOrThrow(
    await analyticsFetch('/v1/analytics/dashboards', { signal }),
    '分析仪表盘清单读取失败',
  ) as { dashboards?: EmbeddableDashboard[] }
  return payload.dashboards ?? []
}

export async function fetchGuestToken(dashboardId: string): Promise<GuestTokenResponse> {
  return parseOrThrow(
    await analyticsFetch('/v1/analytics/guest-token', {
      method: 'POST',
      body: JSON.stringify({ dashboardId }),
    }),
    '访客令牌签发失败',
  ) as Promise<GuestTokenResponse>
}

/** 嵌入专用 origin：门户 nginx 专用监听（默认同主机 18084）。 */
export const supersetEmbedOrigin: string =
  (import.meta.env.VITE_DATAOS_SUPERSET_EMBED_ORIGIN as string | undefined ?? '').trim() ||
  (typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.hostname}:18084`
    : '')
