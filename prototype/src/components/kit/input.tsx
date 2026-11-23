import { Search, X } from 'lucide-react'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

const controlBase =
  'w-full min-h-9 rounded-control border border-line-strong bg-paper px-2.5 py-2 text-body-sm text-ink-soft placeholder:text-faint focus-visible:border-blue focus-visible:outline-2 focus-visible:outline-blue focus-visible:outline-offset-2 disabled:bg-wash disabled:text-faint'

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(controlBase, className)} {...props} />
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(controlBase, 'min-h-[85px] resize-y', className)} {...props} />
}

/** 代码/JSON/SQL 编辑器：等宽、浅底、较高。 */
export function CodeTextarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      spellCheck={false}
      className={cn(controlBase, 'min-h-[150px] resize-y bg-wash font-mono text-label leading-relaxed text-ink-soft', className)}
      {...props}
    />
  )
}

/** 原生下拉：批准原型用原生 select 承载筛选与表单枚举，离线可靠、键盘行为无需自造。 */
export function NativeSelect({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'min-h-[34px] w-full appearance-none rounded-control border border-line-strong bg-paper bg-[url("data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20width%3D%2710%27%20height%3D%276%27%20viewBox%3D%270%200%2010%206%27%3E%3Cpath%20d%3D%27M1%201l4%204%204-4%27%20fill%3D%27none%27%20stroke%3D%27%237c8795%27%20stroke-width%3D%271.4%27%20stroke-linecap%3D%27round%27%20stroke-linejoin%3D%27round%27%2F%3E%3C%2Fsvg%3E")] bg-[length:10px_6px] bg-[right_9px_center] bg-no-repeat py-0 pl-2.5 pr-7 text-label text-ink-soft focus-visible:border-blue focus-visible:outline-2 focus-visible:outline-blue focus-visible:outline-offset-2',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  )
}

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
