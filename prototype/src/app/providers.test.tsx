import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installBrowserApiStubs } from '../test-support/browser-apis'
import { SessionProvider, useAuth } from './providers'

beforeEach(() => installBrowserApiStubs())
afterEach(() => {
  cleanup()
  sessionStorage.clear()
})

function EpochProbe() {
  const { sessionEpoch } = useAuth()
  return <span data-testid="epoch">{sessionEpoch}</span>
}

describe('会话隔离', () => {
  it('401 事件推进会话代际，Query 缓存随之作废', async () => {
    render(
      <SessionProvider>
        <EpochProbe />
      </SessionProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('epoch').textContent).toBe('0'))

    // 传输层在 401 时广播该事件（data/http.ts）；会话层清会话并推进代际。
    window.dispatchEvent(new CustomEvent('dataos:auth-required'))
    await waitFor(() => expect(screen.getByTestId('epoch').textContent).toBe('1'))
  })

  it('OIDC 错误事件进入 error 快照，不冒充已认证', async () => {
    function SnapshotProbe() {
      const { snapshot } = useAuth()
      return <span data-testid="status">{snapshot.status}</span>
    }
    render(
      <SessionProvider>
        <SnapshotProbe />
      </SessionProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('disabled'))

    window.dispatchEvent(new CustomEvent('dataos:oidc-error', { detail: 'OIDC state 校验失败' }))
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('error'))
  })
})
