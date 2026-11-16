import { QueryClient, QueryClientContext, QueryClientProvider } from '@tanstack/react-query'
import { useContext, useState, type ReactNode } from 'react'

/**
 * 独立挂载边界：正式路由复用会话级 QueryClient；仅在无 Provider 的独立挂载
 * （组件测试、嵌入式预览）时提供局部 Client，保证同一组件两处挂载都可用，
 * 测试不必为此加 Provider 或改断言。
 */
export function QueryBoundary({ children }: { children: ReactNode }) {
  const inherited = useContext(QueryClientContext)
  const [local] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false, staleTime: 15_000 },
      mutations: { retry: false },
    },
  }))
  const client = inherited ?? local
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
