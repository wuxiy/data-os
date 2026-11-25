import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installBrowserApiStubs } from '../../test-support/browser-apis'

vi.mock('../../data/controlPlane', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../data/controlPlane')>()
  return { ...actual, fetchSourceCatalogs: vi.fn(), fetchSourceTables: vi.fn(), fetchSourceColumns: vi.fn() }
})

import { fetchSourceCatalogs, fetchSourceColumns, fetchSourceTables, type SourceApiItem } from '../../data/controlPlane'
import { StructuredTaskFields } from './structured-fields'

const source: SourceApiItem = {
  id: 'src-lis-001', tenantId: 'tenant', institutionId: 'hospital', name: '检验信息系统', systemType: 'LIS', protocol: 'JDBC', status: 'ACTIVE',
  createdAt: '2026-11-01T00:00:00Z', lastCheckedAt: null, lastCheckMessage: null, connection: { jdbcUrl: 'jdbc:sqlserver://lis' },
}

function renderForm() {
  const onSubmit = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <StructuredTaskFields
        source={source}
        initial={null}
        lastSuccessWatermark={null}
        saving={false}
        submitLabel="创建任务"
        onSubmit={onSubmit}
      />
    </QueryClientProvider>,
  )
  return onSubmit
}

/** 逐字输入：每一步都断言输入框显示的内容，受控值一旦不随状态更新就会在这里露出来。 */
function typeInto(element: HTMLElement, text: string) {
  for (let length = 1; length <= text.length; length += 1) {
    const value = text.slice(0, length)
    fireEvent.change(element, { target: { value } })
    expect((element as HTMLInputElement).value).toBe(value)
  }
}

beforeEach(() => {
  installBrowserApiStubs()
  vi.mocked(fetchSourceCatalogs).mockResolvedValue({ catalogs: ['lis_db'], truncated: false })
  vi.mocked(fetchSourceTables).mockResolvedValue({ tables: [{ name: 'lab_result', type: 'TABLE', remark: '检验结果' }], truncated: false })
  vi.mocked(fetchSourceColumns).mockResolvedValue({ columns: [{ name: 'result_id', typeName: 'VARCHAR(64)', nullable: false, remark: '' }] })
})

afterEach(() => { cleanup(); vi.resetAllMocks() })

describe('结构化任务表单', () => {
  it('受控输入逐字输入不丢字，提交时带上完整值', async () => {
    const onSubmit = renderForm()
    typeInto(screen.getByLabelText('目标仓库 FE 地址'), 'doris-fe.internal:8030')
    typeInto(screen.getByLabelText('目标仓库凭据引用'), 'cred-lis-ro')

    // 切到 SQL 形态避开表选择：形态是 coss SegmentedControl 的单选原语。
    fireEvent.click(screen.getByRole('radio', { name: /SQL 任务/ }))
    const sql = await screen.findByLabelText('查询语句（只读 · 单条 SELECT/WITH）')
    typeInto(sql, 'SELECT 1')
    typeInto(screen.getByLabelText('目标表名'), 'ods_lis.lab_result')

    fireEvent.submit(document.querySelector('form')!)
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      form: 'SQL', customSql: 'SELECT 1', targetTable: 'ods_lis.lab_result',
      sinkFenodes: 'doris-fe.internal:8030', sinkCredentialRef: 'cred-lis-ro',
    })
  })

  it('切换任务形态后出现对应形态的输入', async () => {
    renderForm()
    expect(screen.getByLabelText('源库')).toBeTruthy()
    expect(screen.queryByLabelText('查询语句（只读 · 单条 SELECT/WITH）')).toBeNull()

    fireEvent.click(screen.getByRole('radio', { name: /SQL 任务/ }))
    expect(await screen.findByLabelText('查询语句（只读 · 单条 SELECT/WITH）')).toBeTruthy()
    expect(screen.queryByLabelText('源库')).toBeNull()

    fireEvent.click(screen.getByRole('radio', { name: /表任务/ }))
    await waitFor(() => expect(screen.getByLabelText('源库')).toBeTruthy())
  })
})
