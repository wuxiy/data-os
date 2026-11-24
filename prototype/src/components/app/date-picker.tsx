import { zhCN } from '@daypicker/react/locale'
import { CalendarIcon } from 'lucide-react'
import type { ChangeEvent, ComponentProps } from 'react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Popover, PopoverPopup, PopoverTrigger } from '@/components/ui/popover'

const pad = (value: number) => String(value).padStart(2, '0')

/** 项目用 ISO 日期字符串（yyyy-MM-dd）表示日期，空串表示未选；这里在它与 Date 之间换算。 */
function parseDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return undefined
  const [year, month, day] = match.slice(1).map(Number)
  const date = new Date(year, month - 1, day)
  const exact = date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
  return exact ? date : undefined
}

const formatDate = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

type DatePickerProps = Omit<ComponentProps<'input'>, 'type' | 'value' | 'defaultValue' | 'size' | 'onChange'> & {
  value: string
  onValueChange: (value: string) => void
}

/**
 * 日期选择：输入框可直接键入 yyyy-MM-dd，日历按钮弹出 coss Calendar（蓝本 p-date-picker-5）。
 * 键入到一半的文本留在本地，凑成合法日期或被清空时才上报。
 */
export function DatePicker({ value, onValueChange, disabled, className, ...props }: DatePickerProps) {
  const selected = parseDate(value)
  const [month, setMonth] = useState(() => selected ?? new Date())
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<{ base: string; text: string } | null>(null)
  // 外部值一旦变化（如被重置），未完成的草稿即作废。
  const editing = draft && draft.base === value
  const text = editing ? draft.text : value

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value
    const date = parseDate(next)
    if (date || next === '') {
      setDraft(null)
      if (date) setMonth(date)
      onValueChange(date ? formatDate(date) : '')
      return
    }
    setDraft({ base: value, text: next })
  }

  const handleSelect = (date: Date | undefined) => {
    setOpen(false)
    setDraft(null)
    onValueChange(date ? formatDate(date) : '')
  }

  const triggerLabel = typeof props['aria-label'] === 'string' ? `选择${props['aria-label']}` : '选择日期'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <InputGroup className={className}>
        <InputGroupInput
          {...props}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="YYYY-MM-DD"
          disabled={disabled}
          aria-invalid={editing ? true : props['aria-invalid']}
          value={text}
          onChange={handleInputChange}
        />
        <InputGroupAddon>
          <PopoverTrigger aria-label={triggerLabel} disabled={disabled} render={<Button size="icon-xs" variant="ghost" />}>
            <CalendarIcon aria-hidden="true" />
          </PopoverTrigger>
        </InputGroupAddon>
      </InputGroup>
      <PopoverPopup align="start" alignOffset={-4} sideOffset={8}>
        <Calendar
          mode="single"
          locale={zhCN}
          month={month}
          onMonthChange={setMonth}
          selected={selected}
          onSelect={handleSelect}
          disabled={disabled}
        />
      </PopoverPopup>
    </Popover>
  )
}
