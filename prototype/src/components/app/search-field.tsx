import { Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { cn } from '@/lib/utils'

/** 列表检索框：coss InputGroup 组合——搜索图标、输入与清除按钮；250px 默认宽。 */
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
    <InputGroup className={cn('w-[250px] max-w-full', className)}>
      <InputGroupInput
        type="search"
        aria-label={label ?? placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
      />
      <InputGroupAddon>
        <Search aria-hidden="true" />
      </InputGroupAddon>
      {value ? (
        <InputGroupAddon align="inline-end">
          <Button size="icon-xs" variant="ghost" aria-label="清除搜索" onClick={() => onValueChange('')}>
            <X />
          </Button>
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  )
}
