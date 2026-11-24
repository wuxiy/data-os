import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installBrowserApiStubs } from '../../test-support/browser-apis'
import { ConfirmDialog } from './confirm-dialog'

beforeEach(() => installBrowserApiStubs())
afterEach(() => cleanup())

describe('后果确认', () => {
  it('初始焦点在取消，确认动作不回写打开态', async () => {
    const onOpenChange = vi.fn()
    const onConfirm = vi.fn()
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="删除质量规则"
        description="规则将被删除，并从质量执行器同步摘除。"
        object={{ name: '门诊就诊记录主键唯一', meta: 'RULE-VAL-001 · 唯一性' }}
        confirmLabel="删除规则"
        tone="destructive"
        onConfirm={onConfirm}
      />,
    )
    const cancel = screen.getByRole('button', { name: '取消' })
    await waitFor(() => expect(document.activeElement).toBe(cancel))

    fireEvent.click(screen.getByRole('button', { name: '删除规则' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('执行中禁止重复确认与取消', () => {
    render(
      <ConfirmDialog open onOpenChange={() => {}} title="下线数据服务" confirmLabel="下线服务" busy onConfirm={() => {}} />,
    )
    expect((screen.getByRole('button', { name: '下线服务' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
