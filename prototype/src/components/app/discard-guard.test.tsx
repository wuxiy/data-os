import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installBrowserApiStubs } from '../../test-support/browser-apis'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@/components/ui/dialog'
import { Drawer, DrawerClose, DrawerHeader, DrawerPanel, DrawerPopup, DrawerTitle } from '@/components/ui/drawer'
import { DiscardPrompt, useDiscardGuard } from './discard-guard'

beforeEach(() => installBrowserApiStubs())
afterEach(() => cleanup())

/** 守卫与容器无关：这里用右侧抽屉和居中弹窗各搭一个最小容器。 */
function GuardedDrawer({ dirty, onOpenChange, children }: { dirty: boolean; onOpenChange: (open: boolean) => void; children?: React.ReactNode }) {
  const guard = useDiscardGuard(dirty, onOpenChange)
  return (
    <Drawer open onOpenChange={guard.requestOpenChange} position="right">
      <DrawerPopup variant="straight" showCloseButton={false}>
        <DrawerClose aria-label="关闭" render={<Button size="icon" variant="ghost" />}><X /></DrawerClose>
        <DrawerHeader><DrawerTitle>容器</DrawerTitle></DrawerHeader>
        <DrawerPanel>
          {guard.discardPrompt ? <DiscardPrompt onKeepEditing={guard.keepEditing} onDiscard={guard.confirmDiscard} /> : null}
          {children}
        </DrawerPanel>
      </DrawerPopup>
    </Drawer>
  )
}

function GuardedDialog({ dirty, onOpenChange, children }: { dirty: boolean; onOpenChange: (open: boolean) => void; children?: React.ReactNode }) {
  const guard = useDiscardGuard(dirty, onOpenChange)
  return (
    <Dialog open onOpenChange={guard.requestOpenChange}>
      <DialogPopup closeProps={{ 'aria-label': '关闭' }}>
        <DialogHeader>
          <DialogTitle>容器</DialogTitle>
          <DialogDescription>说明</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {guard.discardPrompt ? <DiscardPrompt onKeepEditing={guard.keepEditing} onDiscard={guard.confirmDiscard} /> : null}
          {children}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  )
}

describe('抽屉未保存退出守卫', () => {
  it('脏数据关闭请求原位询问，放弃修改后才关闭', async () => {
    const onOpenChange = vi.fn()
    render(<GuardedDrawer dirty onOpenChange={onOpenChange}><div>容器内容</div></GuardedDrawer>)
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(await screen.findByText('继续编辑')).toBeTruthy()

    fireEvent.click(screen.getByText('放弃修改'))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('无未保存内容时关闭请求直接生效', async () => {
    const onOpenChange = vi.fn()
    render(<GuardedDrawer dirty={false} onOpenChange={onOpenChange}><div>只读内容</div></GuardedDrawer>)
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('继续编辑保留输入，不关闭容器', async () => {
    const onOpenChange = vi.fn()
    render(<GuardedDrawer dirty onOpenChange={onOpenChange}><textarea aria-label="处理说明" defaultValue="已填写的说明" /></GuardedDrawer>)
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    fireEvent.click(await screen.findByText('继续编辑'))
    expect(onOpenChange).not.toHaveBeenCalled()
    expect((screen.getByLabelText('处理说明') as HTMLTextAreaElement).value).toBe('已填写的说明')
  })
})

describe('弹窗未保存退出守卫', () => {
  it('短表单脏数据关闭时留在原弹窗询问', async () => {
    const onOpenChange = vi.fn()
    render(<GuardedDialog dirty onOpenChange={onOpenChange}><input aria-label="来源名称" defaultValue="门诊 HIS" /></GuardedDialog>)
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(await screen.findByText('继续编辑')).toBeTruthy()
  })
})
