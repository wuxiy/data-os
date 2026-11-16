import { RouterProvider } from '@tanstack/react-router'
import { router } from './app/router'
import { SessionProvider } from './app/providers'
import { AuthGate } from './app/auth-gate'

/**
 * 应用入口：会话（OIDC + 会话级 QueryClient）包住 Router，未认证会话在门外阻断。
 * 旧 App 的 switch/手写 history 分发器已由 app/router.tsx 取代。
 */
export function App() {
  return (
    <SessionProvider>
      <AuthGate>
        <RouterProvider router={router} />
      </AuthGate>
    </SessionProvider>
  )
}
