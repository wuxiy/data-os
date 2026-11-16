import type { ReactNode } from 'react'
import { OidcLoginGate } from '../components/auth/OidcLoginGate'
import { useAuth } from './providers'

/**
 * 会话门：未登录/加载中/认证失败时阻断全部业务路由（旧页与新页一致）。
 * 本地直连（未配置 OIDC）与已认证会话直接放行。
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { snapshot } = useAuth()
  if (snapshot.status !== 'disabled' && snapshot.status !== 'authenticated') {
    return <OidcLoginGate snapshot={snapshot} />
  }
  return children
}
