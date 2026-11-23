import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../../lib/utils'

/**
 * 按钮：批准原型的密度（33px 主高、28px 小号）与语义（主/次/危险/危险描边/文字）。
 * 迁移期由 Base UI 之外的普通 button 承担——按钮不需要浮层行为，原生控件更轻。
 */
const buttonVariants = cva(
  'inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-control border text-body-sm font-medium transition-colors disabled:pointer-events-none disabled:bg-[#eff1f5] disabled:text-muted disabled:border-[#e3e6ec]',
  {
    variants: {
      variant: {
        primary: 'border-blue bg-blue text-white shadow-[0_1px_2px_#1d3d7e10] hover:border-blue-hover hover:bg-blue-hover',
        outline: 'border-line-strong bg-paper text-ink-soft hover:border-[#bcc9da] hover:bg-wash',
        danger: 'border-[#b84747] bg-[#b84747] text-white hover:border-red-deep hover:bg-red-deep',
        'danger-outline': 'border-[#e4c7c7] bg-paper text-red hover:border-[#d8b1b1] hover:bg-red-soft',
        quiet: 'border-transparent bg-transparent text-muted hover:bg-wash hover:text-ink',
        text: 'border-transparent bg-transparent px-0 text-blue hover:text-blue hover:underline hover:underline-offset-4',
      },
      size: {
        md: 'min-h-9 px-3.5',
        sm: 'min-h-8 px-3 text-label',
        xs: 'min-h-[24px] px-2 text-label',
        icon: 'size-[31px] border-line-strong bg-paper p-0 text-muted hover:border-[#becbdf] hover:bg-wash',
        'icon-plain': 'size-[30px] border-transparent p-0 text-muted hover:bg-wash hover:text-ink',
      },
      pill: { true: 'rounded-full', false: '' },
    },
    defaultVariants: { variant: 'outline', size: 'md', pill: false },
  },
)

type ButtonProps = ComponentProps<'button'> & VariantProps<typeof buttonVariants> & {
  /** 尾部主图标（如箭头）；与 children 一起渲染。 */
  trailing?: ReactNode
}

export function Button({ className, variant, size, pill, type = 'button', trailing, children, ...props }: ButtonProps) {
  return (
    <button type={type} className={cn(buttonVariants({ variant, size, pill }), className)} {...props}>
      {children}
      {trailing}
    </button>
  )
}

export { buttonVariants }
