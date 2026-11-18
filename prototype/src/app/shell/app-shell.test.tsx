import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter, useNavigate } from '@tanstack/react-router'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installBrowserApiStubs } from '../../test-support/browser-apis'
import { useDirtyLeaveGuard } from '../dirty-leave-guard'

vi.mock('../providers', () => ({ useAuth: () => ({ snapshot: { status: 'disabled' }, technicalAccess: true }) }))
vi.mock('../../features/overview/queries', () => ({ operationsSummaryQuery: () => ({ queryKey: ['test-summary'], queryFn: async () => null }) }))
vi.mock('../../components/ui/RuntimeStatusBanner', () => ({ RuntimeStatusBanner: () => null }))
vi.mock('./command-palette', () => ({ CommandPalette: () => null, useCommandHotkey: () => {} }))

import { AppShell } from './app-shell'

function Editor() {
  const [dirty, setDirty] = useState(false)
  const { guard } = useDirtyLeaveGuard(dirty)
  const navigate = useNavigate()
  return <><h1>编辑页</h1><button onClick={() => setDirty(true)}>修改内容</button><button onClick={() => void navigate({ href: '/' })}>返回首页</button>{guard}</>
}

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const root = createRootRoute({ component: () => <QueryClientProvider client={client}><AppShell><Outlet /></AppShell></QueryClientProvider> })
  const home = createRoute({ getParentRoute: () => root, path: '/', component: () => <h1>首页</h1> })
  const editor = createRoute({ getParentRoute: () => root, path: '/editor', component: Editor })
  const governance = createRoute({ getParentRoute: () => root, path: '/governance', component: () => <h1>治理驾驶舱</h1> })
  const router = createRouter({ routeTree: root.addChildren([home, editor, governance]), history: createMemoryHistory({ initialEntries: ['/editor'] }) })
  return render(<RouterProvider router={router} />)
}

beforeEach(() => { installBrowserApiStubs(); sessionStorage.clear() })
afterEach(() => { cleanup(); sessionStorage.clear() })

describe('关闭未保存的当前页签', () => {
  it('取消关闭后页签保留，随后主动离开也不误删页签', async () => {
    renderApp()
    fireEvent.click(await screen.findByRole('button', { name: '修改内容' }))
    fireEvent.click(await screen.findByRole('button', { name: '关闭工作区页签' }))
    fireEvent.click(await screen.findByRole('button', { name: '继续编辑' }))
    await waitFor(() => expect(screen.queryByText('放弃未保存的修改？')).toBeNull())
    expect(screen.getByRole('button', { name: '关闭工作区页签' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '返回首页' }))
    fireEvent.click(await screen.findByRole('button', { name: '放弃修改' }))
    expect(await screen.findByRole('heading', { name: '首页' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '关闭工作区页签' })).toBeTruthy()
  })

  it('确认放弃并关闭后才删除页签', async () => {
    renderApp()
    fireEvent.click(await screen.findByRole('button', { name: '修改内容' }))
    fireEvent.click(await screen.findByRole('button', { name: '关闭工作区页签' }))
    fireEvent.click(await screen.findByRole('button', { name: '放弃修改' }))
    expect(await screen.findByRole('heading', { name: '首页' })).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('button', { name: '关闭工作区页签' })).toBeNull())
  })
})

it('收起导航后仍可通过数据治理图标进入治理驾驶舱', async () => {
  renderApp()
  await screen.findByRole('heading', { name: '编辑页' })
  fireEvent.click(screen.getAllByRole('button', { name: '收起主导航' })[0])
  fireEvent.click(screen.getByRole('button', { name: '数据治理' }))
  expect(await screen.findByRole('heading', { name: '治理驾驶舱' })).toBeTruthy()
})
