import {
  columnSizingFeature,
  columnVisibilityFeature,
  createColumnHelper,
  rowPaginationFeature,
  rowSelectionFeature,
  tableFeatures,
  useTable,
  type ColumnDef,
  type RowData,
} from '@tanstack/react-table'
import { Columns3, RefreshCw, Maximize2, Minimize2 } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Popover, PopoverOption, PopoverTitle } from '../ui/popover'
import { SearchField, NativeSelect } from '../ui/input'
import { EmptyState, Skeleton } from '../ui/states'

/**
 * 列表面板：批准原型的连续表格工作面（39px 表头、56px 行、细分隔线、数字右对齐）。
 * 表状态由 TanStack Table v9 承担（选择、列可见性、分页窗口），本组件只做呈现；
 * 数据分页归属调用方——服务端分页的页码起点与 total 由各页面按接口登记。
 */
const listFeatures = tableFeatures({
  rowPaginationFeature,
  rowSelectionFeature,
  columnVisibilityFeature,
  columnSizingFeature,
})

export type ListFeatures = typeof listFeatures

/**
 * v9 的列助手必须绑定 features 泛型；页面一律经此工厂创建列，
 * 直接用数组会被放宽成 unknown 并丢失逐列值类型（FE0 探针实测）。
 */
export function listColumnHelper<TData extends RowData>() {
  return createColumnHelper<ListFeatures, TData>()
}

export interface DataTableSelection {
  selected: Set<string>
  onChange: (next: Set<string>) => void
  /** 行是否可选中；默认全部可选。 */
  canSelect?: (id: string) => boolean
  label?: string
}

export interface DataTableProps<TData extends RowData> {
  columns: ColumnDef<ListFeatures, TData, any>[]
  data: TData[]
  getRowId: (row: TData) => string
  /** 选择态由调用方持有；选中行跨页保留在调用方。 */
  selection?: DataTableSelection
  /** 列可见性：键为列 id；未登记的列默认可见。 */
  hiddenColumns?: Set<string>
  onColumnVisibilityChange?: (next: Set<string>) => void
  /** 列显示菜单用的人类可读列名，键为列 id。 */
  columnLabels?: Record<string, string>
  className?: string
  /** 空态；默认是「没有符合条件的记录」。 */
  empty?: ReactNode
  /** 数据读取中：保留表头、行位换成骨架。 */
  loading?: boolean
  /** 页脚（分页等）。 */
  footer?: ReactNode
  /** 行点击（用于整行打开详情）；交互控件内部点击不触发。 */
  onRowClick?: (row: TData) => void
  /** 行级别的 aria-label 辅助。 */
  rowLabel?: (row: TData) => string
}

export function DataTable<TData extends RowData>({
  columns,
  data,
  getRowId,
  selection,
  hiddenColumns,
  onColumnVisibilityChange,
  columnLabels,
  className,
  empty,
  loading = false,
  footer,
  onRowClick,
  rowLabel,
}: DataTableProps<TData>) {
  const rowSelection = useMemo(() => {
    const state: Record<string, true> = {}
    selection?.selected.forEach((id) => { state[id] = true })
    return state
  }, [selection?.selected])

  const allColumns = useMemo(() => {
    if (!selection) return columns
    const selectColumn: ColumnDef<ListFeatures, TData, unknown> = {
      id: '__select',
      header: () => null,
      cell: ({ row }) => (
        <input
          type="checkbox"
          aria-label={`选择${rowLabel ? rowLabel(row.original) : row.id}`}
          checked={row.getIsSelected()}
          disabled={selection.canSelect ? !selection.canSelect(row.id) : false}
          onChange={row.getToggleSelectedHandler()}
          onClick={(event) => event.stopPropagation()}
          className="size-[13px] accent-blue"
        />
      ),
      size: 40,
    }
    return [selectColumn, ...columns]
  }, [columns, selection, rowLabel])

  const table = useTable({
    features: listFeatures,
    columns: allColumns,
    data,
    getRowId: (row) => getRowId(row),
    state: {
      rowSelection,
      columnVisibility: hiddenColumns ? Object.fromEntries([...hiddenColumns].map((id) => [id, false])) : {},
    },
    onRowSelectionChange: (updater) => {
      if (!selection) return
      const nextState = typeof updater === 'function' ? updater(rowSelection) : updater
      selection.onChange(new Set(Object.keys(nextState).filter((id) => nextState[id])))
    },
    enableRowSelection: true,
  })

  const rows = table.getRowModel().rows
  const visibleLeafColumns = table.getVisibleLeafColumns()

  return (
    <div className={cn('min-w-0', className)}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-body-sm whitespace-nowrap">
          <thead className="bg-wash text-[#7b8592]">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    scope="col"
                    style={header.column.id === '__select' ? { width: 40 } : header.column.columnDef.size ? { width: header.column.columnDef.size } : undefined}
                    className={cn(
                      'h-[39px] border-y border-[#e9ecf1] px-[15px] text-label font-normal',
                      header.column.id === '__select' && 'pt-[9px] pr-0 pb-[9px] pl-[18px]',
                    )}
                  >
                    {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.map((row) => {
              const canClick = Boolean(onRowClick)
              return (
                <tr
                  key={row.id}
                  aria-label={rowLabel ? rowLabel(row.original) : undefined}
                  onClick={canClick ? () => onRowClick?.(row.original) : undefined}
                  className={cn(
                    'border-b border-line-soft last:border-b-0 hover:bg-[#fafbfe]',
                    row.getIsSelected() && 'bg-[#f1f6ff]',
                    canClick && 'cursor-pointer',
                  )}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className={cn(
                        'h-14 px-[15px] text-[#576171]',
                        cell.column.id === '__select' && 'pt-[9px] pr-0 pb-[9px] pl-[18px]',
                        cell.column.columnDef.meta && (cell.column.columnDef.meta as { align?: string }).align === 'right' && 'text-right tabular-nums',
                      )}
                    >
                      <table.FlexRender cell={cell} />
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {loading && rows.length === 0 ? <Skeleton rows={5} className="border-t border-line-soft" /> : null}
      {!loading && rows.length === 0 ? (empty ?? (
        <EmptyState
          minHeight={300}
          title="没有符合条件的记录"
          description="尝试调整关键词或筛选条件，查看其他记录。"
        />
      )) : null}
      {footer}
    </div>
  )
}

/** 表格上方工具栏：左侧检索与筛选，右侧刷新、列设置、全屏。 */
export function TableToolbar({
  search,
  searchPlaceholder,
  onSearchChange,
  filters,
  onRefresh,
  refreshing,
  columnLabels,
  hiddenColumns,
  onColumnVisibilityChange,
  fullscreen,
  onToggleFullscreen,
  actions,
}: {
  search?: string
  searchPlaceholder?: string
  onSearchChange?: (value: string) => void
  filters?: ReactNode
  onRefresh?: () => void
  refreshing?: boolean
  columnLabels?: Record<string, string>
  hiddenColumns?: Set<string>
  onColumnVisibilityChange?: (next: Set<string>) => void
  fullscreen?: boolean
  onToggleFullscreen?: () => void
  actions?: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-2.5 px-[18px] py-4">
      <div className="flex min-w-0 items-center gap-2">
        {search !== undefined && onSearchChange ? (
          <SearchField value={search} onValueChange={onSearchChange} placeholder={searchPlaceholder ?? '搜索'} />
        ) : null}
        {filters}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {actions}
        {onRefresh ? (
          <Button size="icon" aria-label="刷新列表" title="刷新列表" onClick={onRefresh} disabled={refreshing}>
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : undefined} />
          </Button>
        ) : null}
        {columnLabels && onColumnVisibilityChange ? (
          <Popover
            trigger={<Button size="icon" aria-label="显示列" title="显示列"><Columns3 size={14} /></Button>}
          >
            <PopoverTitle>显示列</PopoverTitle>
            {Object.entries(columnLabels).map(([id, label]) => (
              <PopoverOption
                key={id}
                checked={!hiddenColumns?.has(id)}
                onCheckedChange={(checked) => {
                  const next = new Set(hiddenColumns ?? [])
                  if (checked) next.delete(id); else next.add(id)
                  onColumnVisibilityChange(next)
                }}
              >
                {label}
              </PopoverOption>
            ))}
          </Popover>
        ) : null}
        {onToggleFullscreen ? (
          <Button
            size="icon"
            aria-pressed={fullscreen}
            aria-label={fullscreen ? '退出全屏表格' : '全屏表格'}
            title={fullscreen ? '退出全屏，Esc' : '全屏表格'}
            onClick={onToggleFullscreen}
          >
            {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/** 分页窗口：不超过 7 页平铺，否则保留首末与当前邻域。 */
function pageWindow(current: number, count: number): (number | '…')[] {
  if (count <= 7) return Array.from({ length: count }, (_, index) => index)
  const keep = new Set([0, count - 1, current - 1, current, current + 1])
  const pages: (number | '…')[] = []
  for (let index = 0; index < count; index += 1) {
    if (keep.has(index)) pages.push(index)
    else if (pages[pages.length - 1] !== '…') pages.push('…')
  }
  return pages
}

/**
 * 分页条：页码 0 基（与各 API client 一致），展示文案 1 基。
 * total 为接口真实总数；截断由页面在表尾声明，不在此伪造。
 */
export function TablePagination({
  page,
  pageSize,
  total,
  onPageChange,
  pageSizeOptions,
  onPageSizeChange,
  label = '列表分页',
  className,
}: {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  pageSizeOptions?: number[]
  onPageSizeChange?: (size: number) => void
  label?: string
  className?: string
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const current = Math.min(page, pageCount - 1)
  const start = total === 0 ? 0 : current * pageSize + 1
  const end = Math.min((current + 1) * pageSize, total)
  return (
    <nav aria-label={label} className={cn('flex items-center justify-between gap-3 border-t border-line px-[18px] py-3.5 text-label text-faint', className)}>
      <span>
        共 {total} 条记录{total ? ` · 第 ${start}–${end} 条` : ''}
      </span>
      <div className="flex items-center gap-1.5">
        {onPageSizeChange && pageSizeOptions?.length ? (
          <NativeSelect
            aria-label="每页条数"
            className="mr-2 w-auto"
            value={String(pageSize)}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
          >
            {pageSizeOptions.map((size) => <option key={size} value={size}>每页 {size} 条</option>)}
          </NativeSelect>
        ) : (
          <span className="mr-2">每页 {pageSize} 条</span>
        )}
        <button
          type="button"
          aria-label="上一页"
          disabled={current <= 0}
          onClick={() => onPageChange(current - 1)}
          className="inline-flex h-[27px] min-w-[27px] items-center justify-center rounded-chip border border-[#e1e6ee] px-1.5 text-label disabled:opacity-40"
        >
          ‹
        </button>
        {pageWindow(current, pageCount).map((item, index) => item === '…'
          ? <span key={`e-${index}`} className="px-0.5">…</span>
          : item === current
            ? <span key={item} aria-current="page" className="inline-flex h-[27px] min-w-[27px] items-center justify-center rounded-chip border border-[#c6d9fa] bg-[#edf3ff] px-1.5 text-label text-blue">{item + 1}</span>
            : <button key={item} type="button" onClick={() => onPageChange(item)} className="inline-flex h-[27px] min-w-[27px] items-center justify-center rounded-chip border border-[#e1e6ee] px-1.5 text-label hover:bg-wash">{item + 1}</button>)}
        <button
          type="button"
          aria-label="下一页"
          disabled={current >= pageCount - 1}
          onClick={() => onPageChange(current + 1)}
          className="inline-flex h-[27px] min-w-[27px] items-center justify-center rounded-chip border border-[#e1e6ee] px-1.5 text-label disabled:opacity-40"
        >
          ›
        </button>
      </div>
    </nav>
  )
}

/** 已选行动作条：跨页保留选择，动作前可见范围。 */
export function SelectionBar({ count, children }: { count: number; children?: ReactNode }) {
  if (count <= 0) return null
  return (
    <div className="flex items-center gap-3.5 border-t border-[#e0e9fa] bg-[#f0f5ff] px-[18px] py-[7px] text-label text-[#3c65ae]">
      <span>已选择 {count} 项</span>
      {children}
    </div>
  )
}

/** 全屏表格容器：Esc 退出由页面处理（保持单一键盘属主）。 */
export function FullscreenFrame({ active, children }: { active: boolean; children: ReactNode }) {
  return <div className={active ? 'fixed inset-3 z-40 flex flex-col overflow-auto rounded-panel border border-line bg-paper shadow-panel' : undefined}>{children}</div>
}
