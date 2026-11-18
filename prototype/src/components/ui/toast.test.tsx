import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { NoticeProvider, useNotice } from './toast'

afterEach(cleanup)

it('错误回执使用紧急播报，后续普通回执恢复普通播报', () => {
  function Actions() {
    const notify = useNotice()
    return <><button onClick={() => notify('保存失败', 'error')}>失败</button><button onClick={() => notify('保存成功')}>成功</button></>
  }
  render(<NoticeProvider><Actions /></NoticeProvider>)
  fireEvent.click(screen.getByRole('button', { name: '失败' }))
  expect(screen.getByText('保存失败').closest('[aria-live]')?.getAttribute('aria-live')).toBe('assertive')
  fireEvent.click(screen.getByRole('button', { name: '成功' }))
  expect(screen.getByText('保存成功').closest('[aria-live]')?.getAttribute('aria-live')).toBe('polite')
})
