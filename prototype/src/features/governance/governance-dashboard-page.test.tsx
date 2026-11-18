import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installBrowserApiStubs } from '../../test-support/browser-apis'

vi.mock('../../data/controlPlane', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../data/controlPlane')>()
  return {
    ...actual,
    fetchGovernanceSummary: vi.fn(),
    fetchQualityScore: vi.fn(),
  }
})

import { fetchGovernanceSummary, fetchQualityScore } from '../../data/controlPlane'
import { GovernanceDashboardPage } from './governance-dashboard-page'

const summary = {
  asOf: '2026-11-16T02:00:00Z',
  tenantId: 't',
  institutionId: 'i',
  metrics: [
    { key: 'quality-pass', label: '质量规则通过率', value: 98.4, unit: '%', target: 95, detail: '最近一轮规则运行', tone: 'healthy' as const },
    { key: 'standard-coverage', label: '标准覆盖率', value: 82.5, unit: '%', target: 90, detail: '已发布标准覆盖的资产比例', tone: 'warning' as const },
  ],
  issues: [
    { id: 'DQ-2', title: '患者证件号完整性校验未通过', severity: 'CRITICAL', status: 'RECHECKING', datasetId: 'mpi_source_identity', ruleId: 'q.mpi.missing', ownerDepartment: '病案管理科', ownerId: 'owner-42', ownerName: '李老师', ticketId: '', impact: '患者主索引 / 12 张表', dueAt: '2026-11-14T09:00:00Z', updatedAt: '2026-11-16T02:00:00Z' },
    { id: 'DQ-1', title: '药品编码不符合院级标准', severity: 'HIGH', status: 'IN_PROGRESS', datasetId: 'ods_ep.ep_order', ruleId: 'q.ep.paystatus', ownerDepartment: '药学部', ownerName: '王药师', ticketId: 'TICKET-001', impact: '门诊医疗 / 38 张表', dueAt: '2026-11-15T09:00:00Z', updatedAt: '2026-11-16T01:20:00Z' },
    { id: 'DQ-0', title: '就诊类型枚举值不规范', severity: 'LOW', status: 'CLOSED', datasetId: 'ods_outpatient_visit', ruleId: 'q.visit.enum', ownerDepartment: '信息中心', ownerName: '陈老师', ticketId: '', impact: '门诊医疗 / 6 张表', dueAt: '2026-11-10T09:00:00Z', updatedAt: '2026-11-10T10:00:00Z' },
  ],
}

const emptyScore = {
  standard: { passScore: 60, weights: {}, grades: [], updatedAt: '2026-11-01T00:00:00Z' },
  dimensions: [],
  totalScore: null,
  grade: null,
  rules: [{ ruleId: 'q.only', datasetId: 'ods.a', score: null, passed: null }],
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rootRoute = createRootRoute()
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => (
      <QueryClientProvider client={client}>
        <GovernanceDashboardPage />
      </QueryClientProvider>
    ),
  })
  const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute]), history: createMemoryHistory({ initialEntries: ['/'] }) })
  return render(<RouterProvider router={router} />)
}

beforeEach(() => {
  installBrowserApiStubs()
  vi.mocked(fetchGovernanceSummary).mockResolvedValue(summary)
  vi.mocked(fetchQualityScore).mockResolvedValue(emptyScore)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('治理驾驶舱', () => {
  it('待办按 SLA 升序、已闭环被排除，指标来自摘要接口', async () => {
    renderPage()
    // 首位待办同时出现在待办表与责任链摘要，两处都按真实数据渲染。
    expect((await screen.findAllByText('患者证件号完整性校验未通过')).length).toBeGreaterThan(0)
    expect(screen.getByText('药品编码不符合院级标准')).toBeTruthy()
    expect(screen.queryByText('就诊类型枚举值不规范')).toBeNull()
    expect(screen.getByText('质量规则通过率')).toBeTruthy()
    expect(screen.getByText('98.4')).toBeTruthy()

    // 排序：SLA 更早（11-14）的复检中问题排在 11-15 之前。
    const first = screen.getAllByText(/患者证件号完整性校验未通过|药品编码不符合院级标准/)[0]
    expect(first.textContent).toContain('患者证件号')
  })

  it('责任链摘要取首位待办，并展示五类关联键', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('治理责任链 · v1')).toBeTruthy())
    expect(screen.getAllByText('患者证件号完整性校验未通过').length).toBeGreaterThan(1)
    expect(screen.getByText('q.mpi.missing')).toBeTruthy()
    expect(screen.getByText('病案管理科 · 李老师')).toBeTruthy()
    expect(screen.getByText('尚未关联工单')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /打开 DQ-2 的责任链/ }))
    expect(await screen.findByText('datasetId: mpi_source_identity')).toBeTruthy()
    expect(screen.getByText('ownerId: owner-42')).toBeTruthy()
    expect(screen.queryByText(/assetId:/)).toBeNull()
  })

  it('摘要不可用时显示真实不可用态，不补静态样例', async () => {
    vi.mocked(fetchGovernanceSummary).mockRejectedValue(new Error('down'))
    renderPage()
    expect(await screen.findByText('治理控制面不可用')).toBeTruthy()
    expect(screen.getByText(/控制面暂不可用 · 未加载真实治理指标或问题/)).toBeTruthy()
    expect(screen.queryByText('质量规则通过率')).toBeNull()
  })

  it('无带评分规则时评分面板收成一行空态', async () => {
    renderPage()
    expect(await screen.findByText('等待首轮质量评分')).toBeTruthy()
  })
})
