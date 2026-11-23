import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  canGovernAssistant,
  clearOidcSession,
  hasTechnicalAccess,
  initializeOidc,
  logoutOidc,
  oidcIsConfigured,
  type AuthSnapshot,
} from '../data/oidc'
import { NoticeProvider } from '../components/kit/toast'

interface AuthContextValue {
  snapshot: AuthSnapshot
  technicalAccess: boolean
  assistantGovernance: boolean
  configured: boolean
  logout?: () => void
  /** 会话代际：登录会话变化、退出、401、到期时递增，Query 缓存随之作废。 */
  sessionEpoch: number
  invalidateSession: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

/**
 * 会话与 Query 生命周期（计划 §4.1）：
 * AuthSnapshot 没有 tenant/subject 字段，身份键只能是不含 token 的会话代际。
 * 401、退出、会话失效都让代际 +1，旧 QueryClient 连同缓存被丢弃，
 * 避免上一个会话的数据泄漏进下一个会话。
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<AuthSnapshot>(() => (oidcIsConfigured() ? { status: 'loading' } : { status: 'disabled' }))
  const [sessionEpoch, setSessionEpoch] = useState(0)

  const invalidateSession = useCallback(() => {
    clearOidcSession()
    setSessionEpoch((epoch) => epoch + 1)
  }, [])

  useEffect(() => {
    let active = true
    void initializeOidc().then((next) => {
      if (active) setSnapshot(next)
    })
    const handleUnauthorized = () => {
      invalidateSession()
      setSnapshot({ status: 'unauthenticated' })
    }
    const handleOidcError = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail
      setSnapshot({ status: 'error', error: detail || 'OIDC 登录失败' })
    }
    window.addEventListener('dataos:auth-required', handleUnauthorized)
    window.addEventListener('dataos:oidc-error', handleOidcError)
    return () => {
      active = false
      window.removeEventListener('dataos:auth-required', handleUnauthorized)
      window.removeEventListener('dataos:oidc-error', handleOidcError)
    }
  }, [invalidateSession])

  const client = useMemo(() => new QueryClient({
    defaultOptions: {
      queries: {
        // 默认不自动重试、不因窗口聚焦重发；重试由可见按钮触发（计划 §4.1）。
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        staleTime: 15_000,
        gcTime: 5 * 60_000,
      },
      mutations: {
        // 一次用户意图只调用一次客户端；不得自动重调生成新的幂等键。
        retry: false,
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 代际是唯一重建条件
  }), [sessionEpoch])

  const value = useMemo<AuthContextValue>(() => ({
    snapshot,
    technicalAccess: hasTechnicalAccess(snapshot),
    assistantGovernance: canGovernAssistant(snapshot),
    configured: oidcIsConfigured(),
    logout: oidcIsConfigured()
      ? () => {
          invalidateSession()
          logoutOidc()
        }
      : undefined,
    sessionEpoch,
    invalidateSession,
  }), [snapshot, sessionEpoch, invalidateSession])

  return (
    <AuthContext.Provider value={value}>
      <QueryClientProvider client={client}>
        <NoticeProvider>{children}</NoticeProvider>
      </QueryClientProvider>
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth 必须在 SessionProvider 内使用')
  return value
}
