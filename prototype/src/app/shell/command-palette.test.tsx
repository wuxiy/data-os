import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installBrowserApiStubs } from '../../test-support/browser-apis'

const navigate = vi.fn()
const auth = vi.fn(() => ({ technicalAccess: false }))
vi.mock('@tanstack/react-router', () => ({ useLocation: () => ({ pathname: '/' }) }))
vi.mock('../navigate', () => ({ usePortalNavigate: () => navigate }))
vi.mock('../providers', () => ({ useAuth: () => auth() }))

import { CommandPalette } from './command-palette'

beforeEach(() => { installBrowserApiStubs(); auth.mockReturnValue({ technicalAccess: false }) })
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('页面搜索键盘交互', () => {
  it('非技术角色不显示平台运维入口', async () => {
    render(<CommandPalette open onOpenChange={vi.fn()} />)
    await screen.findByRole('textbox', { name: '搜索页面' })
    expect(screen.queryByRole('button', { name: /平台运维/ })).toBeNull()
  })

  it('同一路由的业务名称均可检索到', async () => {
    render(<CommandPalette open onOpenChange={vi.fn()} />)
    const input = await screen.findByRole('textbox', { name: '搜索页面' })
    fireEvent.change(input, { target: { value: '数据服务' } })
    expect(screen.getByRole('button', { name: /^数据服务\s*数据应用$/ })).toBeTruthy()
  })

  it('搜索框方向键和回车打开选中页面，其他按钮的回车不被拦截', async () => {
    render(<CommandPalette open onOpenChange={vi.fn()} />)
    const input = await screen.findByRole('textbox', { name: '搜索页面' })
    const close = screen.getByRole('button', { name: '关闭命令面板' })
    expect(fireEvent.keyDown(close, { key: 'Enter', cancelable: true })).toBe(true)
    expect(navigate).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(navigate).toHaveBeenCalledWith('/operations-center')
  })
})
