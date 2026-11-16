import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installBrowserApiStubs } from '../../test-support/browser-apis'
import { DataTable, TablePagination, listColumnHelper } from './data-table'

interface Row {
  id: string
  name: string
}

const rows: Row[] = [
  { id: 'COL-001', name: '门诊就诊记录增量采集' },
  { id: 'COL-002', name: '住院病历每日同步' },
]

const helper = listColumnHelper<Row>()
const columns = helper.columns([
  helper.accessor('id', { header: '编号' }),
  helper.accessor('name', { header: '任务名称' }),
])

beforeEach(() => installBrowserApiStubs())
afterEach(() => cleanup())

describe('DataTable', () => {
  it('渲染表头与行内容，选择列回传勾选集合', () => {
    const onChange = vi.fn()
    render(
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        rowLabel={(row) => row.name}
        selection={{ selected: new Set(), onChange }}
      />,
    )
    expect(screen.getByText('编号')).toBeTruthy()
    expect(screen.getByText('住院病历每日同步')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('选择门诊就诊记录增量采集'))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect([...(onChange.mock.calls[0][0] as Set<string>)]).toEqual(['COL-001'])
  })

  it('已选行去勾选后从集合移除', () => {
    const onChange = vi.fn()
    render(
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        rowLabel={(row) => row.name}
        selection={{ selected: new Set(['COL-001']), onChange }}
      />,
    )
    fireEvent.click(screen.getByLabelText('选择门诊就诊记录增量采集'))
    expect([...(onChange.mock.calls[0][0] as Set<string>)]).toEqual([])
  })

  it('空数据显示空态而非空白表体', () => {
    render(<DataTable columns={columns} data={[]} getRowId={(row) => row.id} />)
    expect(screen.getByText('没有符合条件的记录')).toBeTruthy()
  })

  it('隐藏列不渲染对应表头与单元格', () => {
    render(
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        hiddenColumns={new Set(['name'])}
      />,
    )
    expect(screen.getByText('编号')).toBeTruthy()
    expect(screen.queryByText('任务名称')).toBeNull()
    expect(screen.queryByText('住院病历每日同步')).toBeNull()
  })

  it('分页条展示真实总数与区间，并回传 0 基页码', () => {
    const onPageChange = vi.fn()
    render(
      <TablePagination page={0} pageSize={6} total={13} onPageChange={onPageChange} />,
    )
    expect(screen.getByText('共 13 条记录 · 第 1–6 条')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('下一页'))
    expect(onPageChange).toHaveBeenCalledWith(1)
    fireEvent.click(screen.getByText('3'))
    expect(onPageChange).toHaveBeenCalledWith(2)
  })
})
