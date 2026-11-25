import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { installBrowserApiStubs } from '../../test-support/browser-apis'
import { ToastProvider } from '@/components/ui/toast'
import { useNotice } from './notice'

afterEach(cleanup)

/** Toast 入队后由 Base UI 在下一个时钟周期渲染；jsdom 下要等在 act 里才会提交。 */
const flushToasts = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)) }) }

it('错误回执为高优先级（紧急播报），普通回执为普通提示', async () => {
  installBrowserApiStubs()
  function Actions() {
    const notify = useNotice()
    return <><button onClick={() => notify('保存失败', 'error')}>失败</button><button onClick={() => notify('保存成功')}>成功</button></>
  }
  render(<ToastProvider position="bottom-center"><Actions /></ToastProvider>)
  fireEvent.click(screen.getByRole('button', { name: '失败' }))
  await flushToasts()
  expect(screen.getByRole('alertdialog', { hidden: true }).textContent).toContain('保存失败')
  fireEvent.click(screen.getByRole('button', { name: '成功' }))
  await flushToasts()
  expect(screen.getByRole('dialog').textContent).toContain('保存成功')
})
