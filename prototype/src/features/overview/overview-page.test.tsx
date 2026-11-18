import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installBrowserApiStubs } from '../../test-support/browser-apis'

vi.mock('../../data/operationsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../data/operationsApi')>()
  return {
    ...actual,
    fetchOperationsSummary: vi.fn(),
    fetchWorkItems: vi.fn(),
    fetchOperationsEvents: vi.fn(),
  }
})

import { fetchOperationsEvents, fetchOperationsSummary, fetchWorkItems } from '../../data/operationsApi'
import { OverviewPage } from './overview-page'

const summary = {
  asOf: '2026-11-16T02:00:00Z',
  workItemsOpen: 2,
  components: { state: 'READY' as const, ready: 7, degraded: 0, unknown: 0, total: 7 },
  domains: {
    ingestion: { failedRuns: 1, stalledRuns: 2 },
    governance: { openIssues: 8, slaOverdue: 2 },
    notifications: { backlog: 0 },
    contracts: { deliveryBacklog: 0 },
    mpi: { availability: 'UP' as const, reviewPending: 6 },
    dataApi: { failedCalls24h: 0 },
    aiData: { activeBuilds: 1, failedBuilds24h: 0 },
  },
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rootRoute = createRootRoute()
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => (
      <QueryClientProvider client={client}>
        <OverviewPage />
      </QueryClientProvider>
    ),
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  return render(<RouterProvider router={router} />)
}

beforeEach(() => {
  installBrowserApiStubs()
  vi.mocked(fetchOperationsSummary).mockResolvedValue(summary)
  vi.mocked(fetchWorkItems).mockResolvedValue([
    { type: 'run', title: '住院病历每日同步 · 执行失败', severity: 'CRITICAL', sourceType: 'run', sourceId: 'job-3', deepLink: '/ingestion', asOf: '2026-11-15T18:02:00Z' },
    { type: 'issue', title: '药品编码不符合院级标准', severity: 'HIGH', sourceType: 'issue', sourceId: 'DQ-1', deepLink: '/governance', asOf: '2026-11-16T01:20:00Z' },
  ])
  vi.mocked(fetchOperationsEvents).mockResolvedValue([
    { domain: 'INGESTION', type: 'SUCCEEDED', detail: '检验报告结果采集完成（12,860 行）', asOf: '2026-11-16T01:12:00Z' },
  ])
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('总览（真实运营投影）', () => {
  it('指标、待办与事件都来自运营投影，且待办按严重度排序', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('医院数据运营总览')).toBeTruthy())

    expect(await screen.findByText('采集失败（24h）')).toBeTruthy()
    expect(screen.getByText('停滞运行 2 个')).toBeTruthy()
    expect(screen.getByText('SLA 逾期 2 项')).toBeTruthy()
    expect(screen.getByText('组件覆盖 7/7 · 全部就绪')).toBeTruthy()

    expect(await screen.findByText('住院病历每日同步 · 执行失败')).toBeTruthy()
    expect(screen.getByText('药品编码不符合院级标准')).toBeTruthy()
    expect(await screen.findByText('检验报告结果采集完成（12,860 行）')).toBeTruthy()

    // 严重度排序：阻断在 高 之前。
    const texts = screen.getAllByText(/住院病历每日同步 · 执行失败|药品编码不符合院级标准/).map((node) => node.textContent)
    expect(texts[0]).toContain('住院病历每日同步')
  })

  it('摘要不可用时显示真实不可用态，不回退静态指标', async () => {
    vi.mocked(fetchOperationsSummary).mockRejectedValue(new Error('control plane down'))
    renderPage()
    expect(await screen.findByText('运营投影暂不可用')).toBeTruthy()
    expect(screen.queryByText('采集失败（24h）')).toBeNull()
    expect(screen.queryByText('今日采集记录')).toBeNull()
  })

  it('待办单独失败不塌页：事件与覆盖条仍可见', async () => {
    vi.mocked(fetchWorkItems).mockRejectedValue(new Error('work items down'))
    renderPage()
    expect(await screen.findByText('运营待办投影暂不可用')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '优先处理' }).textContent).toBe('优先处理')
    expect(screen.getByText('组件覆盖 7/7 · 全部就绪')).toBeTruthy()
    expect(await screen.findByText('检验报告结果采集完成（12,860 行）')).toBeTruthy()
  })
})
