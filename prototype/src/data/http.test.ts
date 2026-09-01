import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./oidc', () => ({ getAccessToken: vi.fn(() => '') }))

import { getAccessToken } from './oidc'
import { API_BASE_URL, parseJsonOrThrow, PortalHttpError, portalFetch } from './http'

describe('http 传输层', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
    ;(getAccessToken as unknown as ReturnType<typeof vi.fn>).mockReturnValue('')
  })

  function stubFetch(status: number, body: unknown) {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
    )
  }

  it('injects bearer token and dispatches auth-required on 401', async () => {
    ;(getAccessToken as unknown as ReturnType<typeof vi.fn>).mockReturnValue('token-1')
    stubFetch(401, { message: '未认证' })
    const events: string[] = []
    window.addEventListener('dataos:auth-required', () => events.push('fired'))

    await portalFetch('/v1/x')

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[0]).toBe(`${API_BASE_URL}/v1/x`)
    const headers = call[1].headers as Headers
    expect(headers.get('Authorization')).toBe('Bearer token-1')
    expect(headers.get('Accept')).toBe('application/json')
    expect(events).toEqual(['fired'])
    window.removeEventListener('dataos:auth-required', () => events.push('fired'))
  })

  it('sets Content-Type only when a body is present', async () => {
    stubFetch(200, {})
    await portalFetch('/v1/x', { method: 'POST', body: JSON.stringify({ a: 1 }) })
    const withBody = ((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit).headers as Headers
    expect(withBody.get('Content-Type')).toBe('application/json')

    await portalFetch('/v1/y')
    const withoutBody = ((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1][1] as RequestInit).headers as Headers
    expect(withoutBody.get('Content-Type')).toBeNull()
  })

  it('normalizes error bodies across legacy dialects (message, detail, code)', async () => {
    stubFetch(409, { code: 'CONFLICT', message: '同名已存在' })
    const conflict = await parseJsonOrThrow(new Response(JSON.stringify({ code: 'CONFLICT', message: '同名已存在' }), { status: 409 }), '创建失败').catch((cause: unknown) => cause)
    expect(conflict).toBeInstanceOf(PortalHttpError)
    expect((conflict as PortalHttpError).message).toBe('创建失败：同名已存在（HTTP 409）')
    expect((conflict as PortalHttpError).code).toBe('CONFLICT')

    // 历史口径二：control-plane 的 ProblemDetail 用 detail 键。
    const detailOnly = await parseJsonOrThrow(
      new Response(JSON.stringify({ detail: '网关拒绝' }), { status: 502 }), '读取失败',
    ).catch((cause: unknown) => cause) as PortalHttpError
    expect(detailOnly.message).toBe('读取失败：网关拒绝（HTTP 502）')

    // 非 JSON 错误体：仅保留 HTTP 状态。
    const plain = await parseJsonOrThrow(
      new Response('oops', { status: 500 }), '读取失败',
    ).catch((cause: unknown) => cause) as PortalHttpError
    expect(plain.message).toBe('读取失败（HTTP 500）')
    expect(plain.status).toBe(500)
  })

  it('returns parsed json on success', async () => {
    const payload = await parseJsonOrThrow(new Response(JSON.stringify({ items: [1, 2] }), { status: 200 }), 'x')
    expect(payload).toEqual({ items: [1, 2] })
  })
})
