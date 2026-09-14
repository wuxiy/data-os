import { ChevronLeft, ChevronRight } from 'lucide-react'
// 分页控件样式与各页面共用 Pages.module.css；CSS Modules 按文件哈希类名，
// 跨文件引用同一份即可保持样式一处维护（与 Drawer 同一约定）。
import styles from '../../pages/Pages.module.css'

/** 分页窗口：页数不超过 7 时全部平铺，否则保留首末页与当前页邻域，中间折叠为省略号。 */
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

interface PagerProps {
  /** 无障碍名称，如「采集任务分页」。 */
  label: string
  /** 当前页码（0 基）。 */
  page: number
  pageCount: number
  pageSize?: number
  /** 列表面板自带左右内边距时使用，使信息与页码控件对齐列表内容区。 */
  inset?: boolean
  onPageChange: (page: number) => void
}

/** 列表分页原语：单页时不渲染；当前页为非交互高亮块（aria-current），其余为页码按钮。 */
export function Pager({ label, page, pageCount, pageSize, inset, onPageChange }: PagerProps) {
  if (pageCount <= 1) return null
  return (
    <nav className={`${styles.tablePager} ${inset ? styles.pagerInset : ''}`} aria-label={label}>
      <span className={styles.pagerInfo}>第 {page + 1} / {pageCount} 页{pageSize ? ` · 每页 ${pageSize} 条` : ''}</span>
      <div className={styles.pagerControls}>
        <button className={styles.pagerButton} disabled={page === 0} onClick={() => onPageChange(page - 1)}><ChevronLeft size={13} />上一页</button>
        {pageWindow(page, pageCount).map((item, index) => item === '…' ? <span key={`ellipsis-${index}`} className={styles.pagerEllipsis}>…</span> : item === page
          ? <span key={item} className={`${styles.pagerButton} ${styles.pagerButtonCurrent}`} aria-current="page">{item + 1}</span>
          : <button key={item} className={styles.pagerButton} onClick={() => onPageChange(item)}>{item + 1}</button>)}
        <button className={styles.pagerButton} disabled={page === pageCount - 1} onClick={() => onPageChange(page + 1)}>下一页<ChevronRight size={13} /></button>
      </div>
    </nav>
  )
}
