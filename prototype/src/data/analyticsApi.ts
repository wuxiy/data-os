import { parseJsonOrThrow, portalFetch } from './http'

/**
 * 嵌入式分析 API 客户端（控制面 BFF → Superset 访客令牌，见 G4 方案）。
 * 仪表盘以 BFF 白名单为准；嵌入 origin 是门户 nginx 的专用监听端口
 * （默认同主机 18084，可用 VITE_DATAOS_SUPERSET_EMBED_ORIGIN 覆盖）；
 * 传输层（鉴权/401/错误归一）见 http.ts。
 */

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

async function analyticsFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return portalFetch(path, init)
}

export async function fetchEmbeddableDashboards(signal?: AbortSignal): Promise<EmbeddableDashboard[]> {
  const payload = await parseJsonOrThrow(
    await analyticsFetch('/v1/analytics/dashboards', { signal }),
    '分析仪表盘清单读取失败',
  ) as { dashboards?: EmbeddableDashboard[] }
  return payload.dashboards ?? []
}

export async function fetchGuestToken(dashboardId: string): Promise<GuestTokenResponse> {
  return parseJsonOrThrow(
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
