import { Search, X } from 'lucide-react'
import { cn } from '../../lib/utils'

/** 列表检索框：250px 默认宽，内嵌搜索图标与清除按钮。 */
export function SearchField({
  value,
  onValueChange,
  placeholder,
  className,
  label,
}: {
  value: string
  onValueChange: (value: string) => void
  placeholder: string
  className?: string
  label?: string
}) {
  return (
    <div className={cn('relative flex h-8 w-[250px] max-w-full items-center', className)}>
      <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground" />
      <input
        type="search"
        aria-label={label ?? placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        className="h-full w-full rounded-control border border-line-strong bg-paper pl-8 pr-7 text-label text-ink placeholder:text-faint focus-visible:border-blue focus-visible:outline-2 focus-visible:outline-blue focus-visible:outline-offset-2"
      />
      {value ? (
        <button
          type="button"
          aria-label="清除搜索"
          onClick={() => onValueChange('')}
          className="absolute right-1 top-1 inline-flex size-6 items-center justify-center rounded-chip text-faint hover:bg-wash hover:text-ink"
        >
          <X size={12} />
        </button>
      ) : null}
    </div>
  )
}
