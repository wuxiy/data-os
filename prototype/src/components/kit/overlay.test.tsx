import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installBrowserApiStubs } from '../../test-support/browser-apis'
import { Confirm, Dialog, Sheet } from './overlay'

beforeEach(() => installBrowserApiStubs())
afterEach(() => cleanup())

describe('Sheet 未保存退出守卫', () => {
  it('脏数据关闭请求原位询问，放弃修改后才关闭', async () => {
    const onOpenChange = vi.fn()
    render(
      <Sheet open onOpenChange={onOpenChange} title="质量问题详情" dirty>
        <div>容器内容</div>
      </Sheet>,
    )
    fireEvent.click(screen.getByRole('button', { name: '关闭详情' }))
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(await screen.findByText('继续编辑')).toBeTruthy()

    fireEvent.click(screen.getByText('放弃修改'))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('无未保存内容时关闭请求直接生效', async () => {
    const onOpenChange = vi.fn()
    render(
      <Sheet open onOpenChange={onOpenChange} title="采集任务详情">
        <div>只读内容</div>
      </Sheet>,
    )
    fireEvent.click(screen.getByRole('button', { name: '关闭详情' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('继续编辑保留输入，不关闭容器', async () => {
    const onOpenChange = vi.fn()
    render(
      <Sheet open onOpenChange={onOpenChange} title="编辑详情" dirty>
        <textarea aria-label="处理说明" defaultValue="已填写的说明" />
      </Sheet>,
    )
    fireEvent.click(screen.getByRole('button', { name: '关闭详情' }))
    fireEvent.click(await screen.findByText('继续编辑'))
    expect(onOpenChange).not.toHaveBeenCalled()
    expect((screen.getByLabelText('处理说明') as HTMLTextAreaElement).value).toBe('已填写的说明')
  })
})

describe('Dialog 未保存退出守卫', () => {
  it('短表单脏数据关闭时留在原弹窗询问', async () => {
    const onOpenChange = vi.fn()
    render(
      <Dialog open onOpenChange={onOpenChange} title="登记数据源" dirty>
        <input aria-label="来源名称" defaultValue="门诊 HIS" />
      </Dialog>,
    )
    fireEvent.click(screen.getByRole('button', { name: '关闭对话框' }))
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(await screen.findByText('继续编辑')).toBeTruthy()
  })
})

describe('Confirm 后果确认', () => {
  it('初始焦点在取消，确认动作不回写打开态', async () => {
    const onOpenChange = vi.fn()
    const onConfirm = vi.fn()
    render(
      <Confirm
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

  it('执行中禁止重复确认与取消', async () => {
    render(
      <Confirm open onOpenChange={() => {}} title="下线数据服务" confirmLabel="下线服务" busy onConfirm={() => {}} />,
    )
    expect((screen.getByRole('button', { name: '下线服务' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
