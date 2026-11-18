import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installBrowserApiStubs } from '../../test-support/browser-apis'

const notify = vi.hoisted(() => vi.fn())
vi.mock('../../data/controlPlane', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../data/controlPlane')>()
  return { ...actual, fetchGovernanceIssues: vi.fn(), fetchGovernanceIssue: vi.fn(), fetchQualityRules: vi.fn(), updateGovernanceIssueWorkflow: vi.fn(), remindGovernanceIssueOwner: vi.fn(), syncGovernanceIssueRun: vi.fn() }
})
vi.mock('../../components/ui/toast', () => ({ useNotice: () => notify }))

import { fetchGovernanceIssue, fetchGovernanceIssues, fetchQualityRules, remindGovernanceIssueOwner, syncGovernanceIssueRun, updateGovernanceIssueWorkflow, type GovernanceIssueDetailApiResponse } from '../../data/controlPlane'
import { QualityPage } from './quality-page'

const issue = (id: string, title: string, processingNote: string) => ({
  id, title, processingNote, severity: 'HIGH', status: 'IN_PROGRESS', datasetId: 'ods.test', ruleId: 'rule.test',
  ownerDepartment: '信息中心', ownerName: '负责人', ticketId: '', impact: '数据集', dueAt: null,
})
const issueA = issue('A', '问题甲', '甲原说明')
const issueB = issue('B', '问题乙', '乙原说明')
const detail = (item: typeof issueA): GovernanceIssueDetailApiResponse => ({ issue: item, events: [], latestRun: null, runs: [], notifications: [] })

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const root = createRootRoute()
  const route = createRoute({
    getParentRoute: () => root,
    path: '/governance/quality',
    validateSearch: (search: Record<string, unknown>) => search,
    component: () => <QueryClientProvider client={client}><QualityPage /></QueryClientProvider>,
  })
  const router = createRouter({ routeTree: root.addChildren([route]), history: createMemoryHistory({ initialEntries: ['/governance/quality?issue=A'] }) })
  return render(<RouterProvider router={router} />)
}

beforeEach(() => {
  installBrowserApiStubs()
  vi.mocked(fetchGovernanceIssues).mockResolvedValue({ items: [issueA, issueB], total: 2 })
  vi.mocked(fetchGovernanceIssue).mockImplementation(async (id) => detail(id === 'A' ? issueA : issueB))
  vi.mocked(fetchQualityRules).mockResolvedValue({ items: [], total: 0 })
})

afterEach(() => { cleanup(); vi.resetAllMocks() })

describe('质量工作台状态边界', () => {
  it('处理说明重试成功后清除该操作的旧错误', async () => {
    vi.mocked(updateGovernanceIssueWorkflow)
      .mockRejectedValueOnce(new Error('保存失败，请重试'))
      .mockResolvedValueOnce(detail({ ...issueA, processingNote: '已重试保存' }))
    renderPage()
    const note = await screen.findByLabelText('处理说明') as HTMLTextAreaElement
    await waitFor(() => expect(note.value).toBe('甲原说明'))
    fireEvent.change(note, { target: { value: '已重试保存' } })
    fireEvent.click(screen.getByRole('button', { name: '提交说明' }))
    expect(await screen.findByText('保存失败，请重试')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '提交说明' }))
    await waitFor(() => expect(screen.queryByText('保存失败，请重试')).toBeNull())
    expect(vi.mocked(updateGovernanceIssueWorkflow)).toHaveBeenCalledTimes(2)
  })

  it('其他操作成功不会清除处理说明的失败提示', async () => {
    vi.mocked(updateGovernanceIssueWorkflow).mockRejectedValueOnce(new Error('处理说明保存失败'))
    vi.mocked(remindGovernanceIssueOwner).mockResolvedValueOnce(detail(issueA))
    renderPage()
    const note = await screen.findByLabelText('处理说明') as HTMLTextAreaElement
    await waitFor(() => expect(note.value).toBe('甲原说明'))
    fireEvent.change(note, { target: { value: '新说明' } })
    fireEvent.click(screen.getByRole('button', { name: '提交说明' }))
    expect(await screen.findByText('处理说明保存失败')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '提醒责任人' }))
    await waitFor(() => expect(vi.mocked(remindGovernanceIssueOwner)).toHaveBeenCalledTimes(1))
    expect(screen.getByText('处理说明保存失败')).toBeTruthy()
  })

  it('切换问题后迟到的保存失败可见并可返回原问题', async () => {
    let fail!: (error: Error) => void
    vi.mocked(updateGovernanceIssueWorkflow).mockReturnValue(new Promise((_, reject) => { fail = reject }))
    renderPage()
    const note = await screen.findByLabelText('处理说明') as HTMLTextAreaElement
    await waitFor(() => expect(note.value).toBe('甲原说明'))
    fireEvent.change(note, { target: { value: '甲的新说明' } })
    fireEvent.click(screen.getByRole('button', { name: '提交说明' }))
    fireEvent.click(screen.getByRole('button', { name: /问题乙/ }))
    await waitFor(() => expect((screen.getByLabelText('处理说明') as HTMLTextAreaElement).value).toBe('乙原说明'))
    await act(async () => { fail(new Error('甲的保存失败')) })
    expect(await screen.findByText('问题 A 的操作失败')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '查看问题 A' }))
    expect(await screen.findByText('甲的保存失败')).toBeTruthy()
    expect(screen.queryByText('问题 A 的操作失败')).toBeNull()
    expect((screen.getByLabelText('处理说明') as HTMLTextAreaElement).value).toBe('甲的新说明')
  })

  it('离开工作台后迟到的失败通过全局错误回执告知问题编号', async () => {
    let fail!: (error: Error) => void
    vi.mocked(updateGovernanceIssueWorkflow).mockReturnValue(new Promise((_, reject) => { fail = reject }))
    const { unmount } = renderPage()
    const note = await screen.findByLabelText('处理说明') as HTMLTextAreaElement
    await waitFor(() => expect(note.value).toBe('甲原说明'))
    fireEvent.change(note, { target: { value: '甲的新说明' } })
    fireEvent.click(screen.getByRole('button', { name: '提交说明' }))
    unmount()
    await act(async () => { fail(new Error('保存失败')) })
    expect(notify).toHaveBeenCalledWith('问题 A 的操作失败：保存失败', 'error')
  })

  it('手动同步与自动轮询重叠时只请求一次并保留实际终态', async () => {
    const now = new Date().toISOString()
    const run = { id: 'RUN', issueId: 'A', tenantId: 't', institutionId: 'i', ruleId: 'r', datasetId: 'd', executor: 'DBT', status: 'RUNNING', externalId: null, executionBatchId: 'batch', passed: null, resultMessage: null, sampleEvidence: [], artifactUri: null, reconciliationStatus: null, reconciliationMessage: null, submittedAt: now, startedAt: null, finishedAt: null, attemptCount: 1, nextPollAt: now, lastError: null, updatedAt: now }
    const active = { ...detail(issueA), latestRun: run, runs: [run] }
    vi.mocked(fetchGovernanceIssue).mockResolvedValue(active)
    let finish!: (value: GovernanceIssueDetailApiResponse) => void
    vi.mocked(syncGovernanceIssueRun).mockReturnValue(new Promise((resolve) => { finish = resolve }))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '同步复检结果' }))
    await waitFor(() => expect(vi.mocked(syncGovernanceIssueRun)).toHaveBeenCalledTimes(1))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 2200)) })
    expect(vi.mocked(syncGovernanceIssueRun)).toHaveBeenCalledTimes(1)
    await act(async () => { finish({ ...active, issue: { ...issueA, status: 'CLOSED' }, latestRun: { ...run, status: 'SUCCEEDED', passed: true } }) })
    expect(await screen.findByRole('button', { name: '问题已关闭' })).toBeTruthy()
  })

  it('共享同步失败后可重新发起并清除该错误', async () => {
    const now = new Date().toISOString()
    const run = { id: 'RUN', issueId: 'A', tenantId: 't', institutionId: 'i', ruleId: 'r', datasetId: 'd', executor: 'DBT', status: 'RUNNING', externalId: null, executionBatchId: 'batch', passed: null, resultMessage: null, sampleEvidence: [], artifactUri: null, reconciliationStatus: null, reconciliationMessage: null, submittedAt: now, startedAt: null, finishedAt: null, attemptCount: 1, nextPollAt: now, lastError: null, updatedAt: now }
    const active = { ...detail(issueA), latestRun: run, runs: [run] }
    vi.mocked(fetchGovernanceIssue).mockResolvedValue(active)
    let fail!: (error: Error) => void
    vi.mocked(syncGovernanceIssueRun)
      .mockReturnValueOnce(new Promise((_, reject) => { fail = reject }))
      .mockResolvedValueOnce(active)
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '同步复检结果' }))
    await waitFor(() => expect(vi.mocked(syncGovernanceIssueRun)).toHaveBeenCalledTimes(1))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 2200)) })
    expect(vi.mocked(syncGovernanceIssueRun)).toHaveBeenCalledTimes(1)
    await act(async () => { fail(new Error('同步失败')) })
    expect(await screen.findByText('同步失败')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '同步复检结果' }))
    await waitFor(() => expect(screen.queryByText('同步失败')).toBeNull())
    expect(vi.mocked(syncGovernanceIssueRun)).toHaveBeenCalledTimes(2)
  })

  it('问题甲的迟到保存结果不会覆盖切换后问题乙的说明', async () => {
    let finish!: (value: GovernanceIssueDetailApiResponse) => void
    vi.mocked(updateGovernanceIssueWorkflow).mockReturnValue(new Promise((resolve) => { finish = resolve }))
    renderPage()
    const note = await screen.findByLabelText('处理说明') as HTMLTextAreaElement
    await waitFor(() => expect(note.value).toBe('甲原说明'))
    fireEvent.change(note, { target: { value: '甲已保存说明' } })
    fireEvent.click(screen.getByRole('button', { name: '提交说明' }))
    fireEvent.click(screen.getByRole('button', { name: /问题乙/ }))
    await waitFor(() => expect((screen.getByLabelText('处理说明') as HTMLTextAreaElement).value).toBe('乙原说明'))
    await act(async () => { finish(detail({ ...issueA, processingNote: '甲已保存说明' })) })
    expect((screen.getByLabelText('处理说明') as HTMLTextAreaElement).value).toBe('乙原说明')
    fireEvent.click(screen.getByRole('button', { name: /问题甲/ }))
    await waitFor(() => expect((screen.getByLabelText('处理说明') as HTMLTextAreaElement).value).toBe('甲已保存说明'))
  })

  it('规则接口失败时显示可恢复的错误，而不是空规则清单', async () => {
    vi.mocked(fetchQualityRules).mockRejectedValue(new Error('unavailable'))
    renderPage()
    expect(await screen.findByText('质量规则暂不可用')).toBeTruthy()
    expect(screen.getByRole('button', { name: '重新读取规则' })).toBeTruthy()
    expect(screen.queryByText('还没有动态质量规则')).toBeNull()
  })
})
