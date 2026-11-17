import { useNavigate, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useState } from 'react'
import { installBrowserApiStubs } from '../test-support/browser-apis'
import { useDirtyLeaveGuard } from './dirty-leave-guard'

/** 守卫测试夹具：/editor 挂守卫并可切换脏状态；离开目标用与门户一致的 navigate({ href })。 */
function EditorHarness() {
  const navigate = useNavigate()
  const [dirty, setDirty] = useState(false)
  const { allowNextLeave, guard } = useDirtyLeaveGuard(dirty)
  return (
    <div>
      <button type="button" onClick={() => setDirty(true)}>标记未保存</button>
      <button type="button" onClick={() => void navigate({ href: '/other' })}>去目标页</button>
      <button type="button" onClick={() => { allowNextLeave(); void navigate({ href: '/other' }) }}>保存并离开</button>
      {guard}
    </div>
  )
}

function renderApp() {
  const rootRoute = createRootRoute()
  const editorRoute = createRoute({ getParentRoute: () => rootRoute, path: '/editor', component: EditorHarness })
  const otherRoute = createRoute({ getParentRoute: () => rootRoute, path: '/other', component: () => <p>目标页</p> })
  const router = createRouter({ routeTree: rootRoute.addChildren([editorRoute, otherRoute]), history: createMemoryHistory({ initialEntries: ['/editor'] }) })
  return render(<RouterProvider router={router} />)
}

afterEach(cleanup)

describe('脏退出守卫（路由级 blocker）', () => {
  it('干净状态直接离开，不打扰', async () => {
    installBrowserApiStubs()
    renderApp()
    fireEvent.click(await screen.findByText('去目标页'))
    expect(await screen.findByText('目标页')).toBeTruthy()
    expect(screen.queryByText('放弃未保存的修改？')).toBeNull()
  })

  it('脏状态先询问：继续编辑留在本页', async () => {
    installBrowserApiStubs()
    renderApp()
    fireEvent.click(await screen.findByText('标记未保存'))
    fireEvent.click(screen.getByText('去目标页'))
    expect(await screen.findByText('放弃未保存的修改？')).toBeTruthy()
    expect(screen.queryByText('目标页')).toBeNull()
    fireEvent.click(screen.getByText('继续编辑'))
    await waitFor(() => expect(screen.queryByText('放弃未保存的修改？')).toBeNull())
    expect(screen.queryByText('目标页')).toBeNull()
  })

  it('脏状态确认放弃后完成离开', async () => {
    installBrowserApiStubs()
    renderApp()
    fireEvent.click(await screen.findByText('标记未保存'))
    fireEvent.click(screen.getByText('去目标页'))
    expect(await screen.findByText('放弃未保存的修改？')).toBeTruthy()
    fireEvent.click(screen.getByText('放弃修改'))
    expect(await screen.findByText('目标页')).toBeTruthy()
  })

  it('保存成功路径 allowNextLeave 一次性放行，不询问', async () => {
    installBrowserApiStubs()
    renderApp()
    fireEvent.click(await screen.findByText('标记未保存'))
    fireEvent.click(screen.getByText('保存并离开'))
    expect(await screen.findByText('目标页')).toBeTruthy()
    expect(screen.queryByText('放弃未保存的修改？')).toBeNull()
  })
})
