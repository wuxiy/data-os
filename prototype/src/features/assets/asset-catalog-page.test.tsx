import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installBrowserApiStubs } from '../../test-support/browser-apis'
import { renderWithSidebar } from '../../test-support/render-with-sidebar'

vi.mock('../../data/lineageApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../data/lineageApi')>()
  return {
    ...actual,
    fetchLineageSummary: vi.fn(),
    fetchLineageCatalog: vi.fn(),
    fetchLineageAsset: vi.fn(),
    fetchLineageGraph: vi.fn(),
    fetchAssetQualityTests: vi.fn(),
  }
})

import {
  fetchAssetQualityTests,
  fetchLineageAsset,
  fetchLineageCatalog,
  fetchLineageGraph,
  fetchLineageSummary,
} from '../../data/lineageApi'
import { AssetCatalogPage } from './asset-catalog-page'

const summary = {
  service: 'doris-dataos',
  schemas: ['ods_ep', 'dataos_mpi'],
  tableCount: 4,
  columnCount: 46,
  dashboardService: 'superset-dataos',
  dashboards: [{ fullyQualifiedName: 'superset-dataos.model.2', displayName: '处方运营模型', updatedAt: '2026-11-16T00:00:00Z' }],
}

const catalog = {
  service: 'doris-dataos',
  schema: 'ods_ep',
  fetchedAt: '2026-11-16T01:00:00Z',
  assets: [
    { name: 'ep_mz_cfzb', fullyQualifiedName: 'doris-dataos.ods_ep.ep_mz_cfzb', displayName: '门诊处方主表', columnCount: 5, updatedAt: '2026-11-16T01:00:00Z', updatedBy: 'ingest' },
    { name: 'ep_patient', fullyQualifiedName: 'doris-dataos.ods_ep.ep_patient', displayName: '门诊患者', columnCount: 3, updatedAt: '2026-11-16T01:00:00Z', updatedBy: 'ingest' },
  ],
}

function detail(fqn: string) {
  return {
    name: fqn.split('.').pop() as string,
    fullyQualifiedName: fqn,
    displayName: '门诊处方主表',
    description: '门诊处方结构元数据。',
    columns: [
      { name: 'PRESCRIPTION_ID', dataType: 'VARCHAR(64)', description: '处方唯一标识' },
      { name: 'PAY_STATUS', dataType: 'INT', description: '支付状态' },
    ],
    updatedAt: '2026-11-16T01:00:00Z',
  }
}

function renderPage(entries = ['/assets']) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rootRoute = createRootRoute()
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/assets',
    validateSearch: (search: Record<string, unknown>) => search,
    component: () => (
      <QueryClientProvider client={client}>
        <AssetCatalogPage />
      </QueryClientProvider>
    ),
  })
  const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute]), history: createMemoryHistory({ initialEntries: entries }) })
  return renderWithSidebar(<RouterProvider router={router} />)
}

beforeEach(() => {
  installBrowserApiStubs()
  vi.mocked(fetchLineageSummary).mockResolvedValue(summary)
  vi.mocked(fetchLineageCatalog).mockResolvedValue(catalog)
  vi.mocked(fetchLineageAsset).mockImplementation((fqn) => Promise.resolve(detail(fqn)))
  vi.mocked(fetchLineageGraph).mockResolvedValue({
    root: 'doris-dataos.ods_ep.ep_mz_cfzb',
    upstreams: [{ fullyQualifiedName: 'doris-dataos.ods_ep.ep_mz_visit', type: 'table', displayName: '门诊就诊记录', columnMappings: [{ fromColumns: ['VISIT_ID'], toColumn: 'VISIT_ID' }] }],
    downstreams: [{ fullyQualifiedName: 'superset-dataos.model.2', type: 'dataModel', displayName: '处方运营模型', columnMappings: [] }],
  })
  vi.mocked(fetchAssetQualityTests).mockResolvedValue([
    { ruleId: 'quality.ep.order.paystatus-range', datasetId: 'ods_ep.ep_order', selector: 'PAY_STATUS', lastRun: { status: 'SUCCEEDED', passed: true, finishedAt: '2026-11-16T01:00:00Z' } },
  ])
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  window.history.replaceState({}, '', '/')
})

describe('资产目录', () => {
  it('目录、字段与质量测试来自真实接口，服务名经中文口径', async () => {
    renderPage()
    expect((await screen.findAllByText('门诊处方主表')).length).toBeGreaterThan(0)
    expect(screen.getByText('数仓集群 · 电子处方 ODS')).toBeTruthy()
    expect(await screen.findByText('PRESCRIPTION_ID')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: /质量测试/ }))
    expect(await screen.findByText('quality.ep.order.paystatus-range')).toBeTruthy()
    expect(screen.getByText('通过')).toBeTruthy()
  })

  it('深链 ?asset= 直接选中对应资产', async () => {
    renderPage(['/assets?db=ods_ep&asset=doris-dataos.ods_ep.ep_patient'])
    await waitFor(() => expect(vi.mocked(fetchLineageAsset)).toHaveBeenCalledWith('doris-dataos.ods_ep.ep_patient', expect.anything()))
  })

  it('没有 db 参数时按资产全限定名定位所属库', async () => {
    const fqn = 'doris-dataos.default.dataos_mpi.mpi_person'
    vi.mocked(fetchLineageCatalog).mockImplementation(async (schema) => ({
      ...catalog,
      schema: schema ?? 'ods_ep',
      assets: [{ ...catalog.assets[0], name: 'mpi_person', fullyQualifiedName: fqn }],
    }))
    renderPage([`/assets?asset=${fqn}`])
    await waitFor(() => expect(vi.mocked(fetchLineageCatalog)).toHaveBeenCalledWith('dataos_mpi', expect.anything()))
    await waitFor(() => expect(vi.mocked(fetchLineageAsset)).toHaveBeenCalledWith(fqn, expect.anything()))
  })

  it('指定资产不存在时保留空态，不静默切到其他资产', async () => {
    renderPage(['/assets?db=ods_ep&asset=doris-dataos.ods_ep.missing'])
    expect(await screen.findByText('未找到指定资产')).toBeTruthy()
    expect(vi.mocked(fetchLineageAsset)).not.toHaveBeenCalled()
  })

  it('质量规则执行失败时不冒充质量未通过', async () => {
    vi.mocked(fetchAssetQualityTests).mockResolvedValue([
      { ruleId: 'quality.failed', datasetId: 'ods_ep.ep_order', selector: 'PAY_STATUS', lastRun: { status: 'FAILED', passed: false, finishedAt: null } },
    ])
    renderPage()
    await screen.findByText('PRESCRIPTION_ID')
    fireEvent.click(screen.getByRole('tab', { name: /质量测试/ }))
    expect(await screen.findByText('执行失败')).toBeTruthy()
    expect(screen.queryByText('未通过')).toBeNull()
  })

  it('质量测试不可读只降级该页签，字段结构仍可用', async () => {
    vi.mocked(fetchAssetQualityTests).mockRejectedValue(new Error('quality down'))
    renderPage()
    expect(await screen.findByText('PRESCRIPTION_ID')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: /质量测试/ }))
    expect(await screen.findByText('质量结果暂不可读')).toBeTruthy()
    expect(screen.queryByText('通过')).toBeNull()
  })

  it('血缘页签展示上游/下游与列映射数量', async () => {
    renderPage()
    await screen.findByText('PRESCRIPTION_ID')
    fireEvent.click(screen.getByRole('tab', { name: /血缘与消费/ }))
    expect(await screen.findByText('门诊就诊记录')).toBeTruthy()
    expect(screen.getByText('处方运营模型')).toBeTruthy()
    expect(screen.getByText('1 条列级映射')).toBeTruthy()
  })
})
