import { describe, expect, it } from 'vitest'
import { cn } from './utils'

describe('主题类名合并', () => {
  it('保留语义字号和文字颜色，同时仍允许字号后写覆盖', () => {
    expect(cn('text-metric', 'text-amber')).toBe('text-metric text-amber')
    expect(cn('text-body-sm', 'text-ink-soft')).toBe('text-body-sm text-ink-soft')
    expect(cn('text-metric', 'text-heading')).toBe('text-heading')
  })
})
