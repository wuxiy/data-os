import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

/**
 * 表单字段：标签、必填标记、说明与就地错误。
 * 短表单留在 Dialog 内，长编辑进独立工作页——同一字段组件不再重复排版。
 */
export function FormField({
  label,
  required = false,
  hint,
  error,
  htmlFor,
  className,
  children,
}: {
  label: ReactNode
  required?: boolean
  hint?: ReactNode
  error?: ReactNode
  htmlFor?: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn('mb-[17px]', className)}>
      <label htmlFor={htmlFor} className="mb-[7px] block text-body-sm text-ink-soft">
        {label}
        {required ? <em className="ml-0.5 not-italic text-red">*</em> : null}
      </label>
      {children}
      {hint ? <p className="mt-[5px] text-meta leading-relaxed text-muted">{hint}</p> : null}
      {error ? <p role="alert" className="mt-3 text-body-sm leading-relaxed text-red">{error}</p> : null}
    </div>
  )
}

/** 两列表单网格：短表单的默认排布，窄容器自动单列。 */
export function FormGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('grid grid-cols-2 gap-4', className)}>{children}</div>
}

/** 表单顶部说明：边界与口径先于输入。 */
export function FormNotice({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-4 flex items-start gap-2 rounded-control border border-blue-line bg-blue-soft px-3 py-[11px] text-label leading-relaxed text-blue">
      {icon ? <span className="mt-0.5 [&_svg]:size-4">{icon}</span> : null}
      <span className="min-w-0">{children}</span>
    </div>
  )
}
