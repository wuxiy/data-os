import { TableSkeleton } from '@/components/app/table-skeleton'
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
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { Button } from '@/components/ui/button'
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
} from '@/components/ui/pagination'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState } from '@/components/app/empty-state'

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
  getRowId: (row: TData, index: number) => string
  /** 选择态由调用方持有；选中行跨页保留在调用方。 */
  selection?: DataTableSelection
  /** 列可见性：键为列 id；未登记的列默认可见。 */
  hiddenColumns?: Set<string>
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
        <Checkbox
          aria-label={`选择${rowLabel ? rowLabel(row.original) : row.id}`}
          checked={row.getIsSelected()}
          disabled={selection.canSelect ? !selection.canSelect(row.id) : false}
          onCheckedChange={(checked) => row.toggleSelected(checked)}
          onClick={(event) => event.stopPropagation()}
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
    getRowId: (row, index) => getRowId(row, index),
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
      <Table>
        <TableHeader className="bg-wash text-muted-foreground">
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead
                  key={header.id}
                  scope="col"
                  style={header.column.id === '__select' ? { width: 40 } : header.column.columnDef.size ? { width: header.column.columnDef.size } : undefined}
                  className={cn(
                    'h-10 border-y border-line px-4 text-label',
                    header.column.id === '__select' && 'pt-[9px] pr-0 pb-[9px] pl-[18px]',
                  )}
                >
                  {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const canClick = Boolean(onRowClick)
            return (
              <TableRow
                key={row.id}
                aria-label={rowLabel ? rowLabel(row.original) : undefined}
                data-state={row.getIsSelected() ? 'selected' : undefined}
                onClick={canClick ? () => onRowClick?.(row.original) : undefined}
                tabIndex={canClick ? 0 : undefined}
                onKeyDown={canClick ? (event) => {
                  if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
                  event.preventDefault()
                  onRowClick?.(row.original)
                } : undefined}
                className={cn(
                  'last:border-b-0 hover:bg-wash',
                  row.getIsSelected() && 'bg-blue-soft',
                  canClick && 'focus-visible:outline-2 focus-visible:outline-blue focus-visible:outline-offset-[-2px]',
                  canClick && 'cursor-pointer',
                )}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    className={cn(
                      'h-14 px-4 text-ink-soft',
                      cell.column.id === '__select' && 'pt-[9px] pr-0 pb-[9px] pl-[18px]',
                      cell.column.columnDef.meta && (cell.column.columnDef.meta as { align?: string }).align === 'right' && 'text-right tabular-nums',
                    )}
                  >
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      {loading && rows.length === 0 ? <TableSkeleton rows={5} className="border-t border-line-soft" /> : null}
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
  compact = false,
}: {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  pageSizeOptions?: number[]
  onPageSizeChange?: (size: number) => void
  label?: string
  className?: string
  /** 窄栏（侧栏队列）用：省略每页条数与「共 N 条」长文案，保留区间与页码。 */
  compact?: boolean
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const current = Math.min(page, pageCount - 1)
  const start = total === 0 ? 0 : current * pageSize + 1
  const end = Math.min((current + 1) * pageSize, total)
  const pageSizeItems = (pageSizeOptions ?? []).map((size) => ({ value: String(size), label: <>每页 {size} 条</> }))
  return (
    <Pagination
      aria-label={label}
      className={cn('justify-between gap-3 border-t border-line px-[18px] py-3.5 text-label text-faint', compact && 'flex-wrap gap-y-1 px-2 py-2', className)}
    >
      <span className="min-w-0 truncate">
        {compact
          ? (total ? `${start}–${end} / ${total} 条` : '0 条')
          : <>共 {total} 条记录{total ? ` · 第 ${start}–${end} 条` : ''}</>}
      </span>
      <PaginationContent>
        {!compact && onPageSizeChange && pageSizeOptions?.length ? (
          <PaginationItem className="mr-2">
            <Select
              items={pageSizeItems}
              value={String(pageSize)}
              onValueChange={(next) => onPageSizeChange(Number(next ?? ''))}
            >
              <SelectTrigger aria-label="每页条数" className="w-auto min-w-none" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {pageSizeItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </PaginationItem>
        ) : compact ? null : (
          <PaginationItem><span className="mr-2">每页 {pageSize} 条</span></PaginationItem>
        )}
        <PaginationItem>
          <PaginationLink
            aria-label="上一页"
            onClick={() => onPageChange(current - 1)}
            render={<Button variant="outline" size="icon-sm" disabled={current <= 0} />}
          >
            <ChevronLeft />
          </PaginationLink>
        </PaginationItem>
        {pageWindow(current, pageCount).map((item, index) => item === '…'
          ? <PaginationEllipsis key={`e-${index}`} />
          : (
            <PaginationItem key={item}>
              <PaginationLink
                isActive={item === current}
                aria-label={`第 ${item + 1} 页`}
                onClick={() => onPageChange(item)}
                render={<Button variant={item === current ? 'outline' : 'ghost'} size="icon-sm" />}
              >
                {item + 1}
              </PaginationLink>
            </PaginationItem>
          ))}
        <PaginationItem>
          <PaginationLink
            aria-label="下一页"
            onClick={() => onPageChange(current + 1)}
            render={<Button variant="outline" size="icon-sm" disabled={current >= pageCount - 1} />}
          >
            <ChevronRight />
          </PaginationLink>
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  )
}

/** 已选行动作条：跨页保留选择，动作前可见范围。 */
export function SelectionBar({ count, children }: { count: number; children?: ReactNode }) {
  if (count <= 0) return null
  return (
    <div className="flex items-center gap-3.5 border-t bg-accent px-[18px] py-[7px] text-label text-accent-foreground">
      <span>已选择 {count} 项</span>
      {children}
    </div>
  )
}

/** 全屏表格容器：Esc 退出由页面处理（保持单一键盘属主）。 */
export function FullscreenFrame({ active, children }: { active: boolean; children: ReactNode }) {
  return <div className={active ? 'fixed inset-3 z-40 flex flex-col overflow-auto rounded-panel border border-line bg-paper shadow-panel' : undefined}>{children}</div>
}
