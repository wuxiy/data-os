import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AIDataError,
  buildAIDataProduct,
  createAIDataProduct,
  fetchAIDataProducts,
  nextLifecycleTarget,
} from './aiDataApi'

describe('aiDataApi', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  function stubFetch(status: number, body: unknown) {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
    )
  }

  it('lists products from the control plane', async () => {
    stubFetch(200, { items: [{ id: 'p1', name: '指南语料库', lifecycle: 'DRAFT' }], total: 1 })
    const items = await fetchAIDataProducts()
    expect(items).toHaveLength(1)
    expect(items[0].name).toBe('指南语料库')
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/v1/ai-data-products',
      expect.objectContaining({ headers: expect.any(Headers) }),
    )
  })

  it('creates a product with the domain payload', async () => {
    stubFetch(201, { id: 'p2', lifecycle: 'DRAFT', currentVersion: 'v0.1.0' })
    const product = await createAIDataProduct({
      name: '临床指南 RAG 语料库',
      type: 'RAG_CORPUS',
      owner: 'data-team',
      workflow: 'MEDICAL_RAG',
      source: 'ods_ep（合成口径）',
    })
    expect(product.id).toBe('p2')
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[0]).toBe('/api/v1/ai-data-products')
    expect(JSON.parse(call[1].body).type).toBe('RAG_CORPUS')
  })

  it('surfaces the engine guard code on 503', async () => {
    stubFetch(503, { code: 'AI_READY_ENGINE_NOT_CONFIGURED', message: 'AI Ready 评估引擎未接入' })
    const error = await buildAIDataProduct('p1').catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(AIDataError)
    expect((error as AIDataError).status).toBe(503)
    expect((error as AIDataError).code).toBe('AI_READY_ENGINE_NOT_CONFIGURED')
  })

  it('maps conflict responses to errors with status', async () => {
    stubFetch(409, { code: 'CONFLICT', message: '同名 AI Data Product 已存在' })
    const error = await createAIDataProduct({
      name: '重复', type: 'FEATURE_DATASET', owner: 'o', workflow: 'w', source: 's',
    }).catch((cause: unknown) => cause)
    expect((error as AIDataError).status).toBe(409)
    expect((error as AIDataError).message).toContain('同名')
  })
})

describe('nextLifecycleTarget', () => {
  it('follows the main chain and stops at terminal states', () => {
    expect(nextLifecycleTarget('DRAFT')).toBe('CURATED')
    expect(nextLifecycleTarget('ASSESSED')).toBe('CERTIFIED')
    expect(nextLifecycleTarget('SERVING')).toBeNull()
    expect(nextLifecycleTarget('DEPRECATED')).toBeNull()
  })
})
