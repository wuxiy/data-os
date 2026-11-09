import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installBrowserApiStubs } from '../test-support/browser-apis'

// 2026-11-09 走查 P1 回归锁：队列搜索必须走服务端。旧实现只过滤已装载的
// 前 100 条，窗口外候选一律「未找到匹配候选」假阴性。本测试模拟窗口外
// 命中：基础装载不含目标候选，搜索后服务端返回它，断言请求带 q 且列表
// 显示服务端结果。
vi.mock('../data/mpiApi', async () => {
  const actual = await vi.importActual<typeof import('../data/mpiApi')>('../data/mpiApi')
  return {
    ...actual,
    fetchMpiMetrics: vi.fn().mockResolvedValue({
      identitiesLoaded: 2882, goldenPersons: 352, autoMatches: 360, reviewPending: 1128, reviewResolved: 4,
    }),
    fetchMpiCandidates: vi.fn(),
  }
})

import { fetchMpiCandidates, fetchMpiMetrics, type MpiCandidateItem } from '../data/mpiApi'
import { MpiReviewLive } from './MpiReviewLive'

function candidate(taskId: string, nameA: string, nameB: string): MpiCandidateItem {
  return {
    taskId, pairId: 1, status: 'OPEN', createdAt: '2026-11-09T00:00:00Z', ruleId: 'P-ep2', outcome: 'REVIEW',
    identityA: { identity: 'H|EP|1', institution: 'ctest', sourceSystem: 'EP', patientId: '1***1', cardNo: '120112****6978', name: nameA, gender: 'F', age: '59.0' },
    identityB: { identity: 'H|EP|2', institution: 'ctest', sourceSystem: 'EP', patientId: '2***2', cardNo: '120112****6979', name: nameB, gender: 'F', age: '59.0' },
    evidence: [],
  }
}

const baseItem = candidate('task-window-1', '陈测一短信一23', '陈测一104')
const beyondWindowItem = candidate('task-beyond-99', '窗口外患者甲', '窗口外患者乙')

beforeEach(() => {
  installBrowserApiStubs()
  vi.mocked(fetchMpiMetrics).mockClear()
  vi.mocked(fetchMpiCandidates).mockReset().mockImplementation((options = {}) => {
    if (options.query?.trim()) {
      return Promise.resolve({ total: 1, page: 1, size: 100, items: [beyondWindowItem] })
    }
    return Promise.resolve({ total: 1128, page: 1, size: 100, items: [baseItem] })
  })
})

afterEach(cleanup)

describe('MpiReviewLive 队列搜索', () => {
  it('搜索走服务端（请求带 q），窗口外候选可命中', async () => {
    render(<MpiReviewLive onNotice={vi.fn()} />)

    // 基础装载：只有窗口内候选。
    expect(await screen.findByText('陈测一短信一23 ↔ 陈测一104')).toBeTruthy()
    expect(screen.queryByText('窗口外患者甲 ↔ 窗口外患者乙')).toBeNull()

    fireEvent.change(screen.getByLabelText('搜索复核候选'), { target: { value: '窗口外患者甲' } })

    await waitFor(() => {
      expect(fetchMpiCandidates).toHaveBeenCalledWith(
        expect.objectContaining({ query: '窗口外患者甲' }),
        expect.anything(),
      )
    })
    expect(await screen.findByText('窗口外患者甲 ↔ 窗口外患者乙')).toBeTruthy()
  })
})
