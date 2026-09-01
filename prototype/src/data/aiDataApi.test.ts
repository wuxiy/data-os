import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PortalHttpError } from './http'
import {
  buildAIDataProduct,
  createAIDataProduct,
  fetchAIDataProduct,
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
    expect(error).toBeInstanceOf(PortalHttpError)
    expect((error as PortalHttpError).status).toBe(503)
    expect((error as PortalHttpError).code).toBe('AI_READY_ENGINE_NOT_CONFIGURED')
  })

  it('maps conflict responses to errors with status', async () => {
    stubFetch(409, { code: 'CONFLICT', message: '同名 AI Data Product 已存在' })
    const error = await createAIDataProduct({
      name: '重复', type: 'FEATURE_DATASET', owner: 'o', workflow: 'w', source: 's',
    }).catch((cause: unknown) => cause)
    expect((error as PortalHttpError).status).toBe(409)
    expect((error as PortalHttpError).message).toContain('同名')
  })

  it('projects readiness json at the boundary (snake/camel normalized)', async () => {
    stubFetch(200, {
      product: { id: 'p1', name: '指南语料库', lifecycle: 'ASSESSED', currentVersion: 'v0.3.0' },
      versions: [
        {
          id: 'v1', productId: 'p1', versionSn: 'v0.1.0', recipeRef: null, gitCommit: null,
          snapshotAt: null, buildStatus: 'SUCCEEDED',
          readinessJson: JSON.stringify({
            overall: 0.83,
            gate: { certification: 'REVIEW_REQUIRED' },
            evaluation: { eval_set_size: 9, retrieval_recall_at_5: 0.61, precision_at_5: 0.55, mrr: 0.72, citation_correctness: 0.5, faithfulness: 0.44 },
          }),
        },
        {
          id: 'v2', productId: 'p1', versionSn: 'v0.2.0', recipeRef: null, gitCommit: null,
          snapshotAt: null, buildStatus: 'SUCCEEDED',
          readinessJson: JSON.stringify({
            overall: 0.87,
            gate: { certification: 'CANDIDATE' },
            evaluation: { evalSetSize: 9, retrievalRecallAt5: 0.66, precisionAt5: 0.6, mrr: 0.78, citationCorrectness: 0.56, faithfulness: 0.5 },
          }),
        },
        { id: 'v3', productId: 'p1', versionSn: 'v0.3.0', recipeRef: null, gitCommit: null, snapshotAt: null, buildStatus: 'REGISTERED', readinessJson: null },
        { id: 'v4', productId: 'p1', versionSn: 'v0.3.1', recipeRef: null, gitCommit: null, snapshotAt: null, buildStatus: 'SUCCEEDED', readinessJson: '{bad json' },
      ],
    })
    const detail = await fetchAIDataProduct('p1')
    const [snake, camel, missing, broken] = detail.versions
    // snake_case（/evaluate 回写）与 camelCase（旧版报告）归一为同一视图。
    expect(snake.readiness?.overall).toBe(0.83)
    expect(snake.readiness?.certification).toBe('REVIEW_REQUIRED')
    expect(snake.readiness?.evaluation?.evalSetSize).toBe(9)
    expect(snake.readiness?.evaluation?.retrievalRecallAt5).toBe(0.61)
    expect(camel.readiness?.evaluation?.mrr).toBe(0.78)
    expect(camel.readiness?.certification).toBe('CANDIDATE')
    // 未评估与坏 JSON 都投影为 null，原文不再暴露给页面。
    expect(missing.readiness).toBeNull()
    expect(broken.readiness).toBeNull()
    expect('readinessJson' in detail.versions[0]).toBe(false)
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
