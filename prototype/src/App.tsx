import { useEffect, useState } from 'react'
import { OidcLoginGate } from './components/auth/OidcLoginGate'
import { ResponsibilityDrawer } from './components/governance/ResponsibilityChain'
import { AppShell } from './components/layout/AppShell'
import { CommandPalette, type PaletteCommand } from './components/ui/CommandPalette'
import { Toast } from './components/ui/Primitives'
import { clearOidcSession, hasTechnicalAccess, initializeOidc, logoutOidc, oidcIsConfigured, type AuthSnapshot } from './data/oidc'
import { routePaths } from './data/routes'
import { DataStandardsPage } from './pages/DataStandardsPage'
import { DataIngestionPage } from './pages/DataIngestionPage'
import { AnalyticsPage } from './pages/AnalyticsPage'
import { AIDataPage } from './pages/AIDataPage'
import { DataServicesPage } from './pages/DataServicesPage'
import { AssetCatalogPage } from './pages/AssetCatalogPage'
import { AssetTechnicalPage } from './pages/AssetTechnicalPage'
import { AssistantPage } from './pages/AssistantPage'
import { GovernanceDashboardPage } from './pages/GovernanceDashboardPage'
import { ManagementDashboardPage } from './pages/ManagementDashboardPage'
import { OperationsCenterPage } from './pages/OperationsCenterPage'
import { MpiReviewPage } from './pages/MpiReviewPage'
import { QualityIssuesPage } from './pages/QualityIssuesPage'
import { StandardMappingPage } from './pages/StandardMappingPage'
import { PlatformOperationsPage } from './pages/PlatformOperationsPage'
import type { RouteKey } from './types'

function routeFromPath(pathname: string): RouteKey {
  const exact = (Object.entries(routePaths) as [RouteKey, string][]).find(([, path]) => path === pathname)
  return exact?.[0] ?? 'management'
}

/** 命令面板可直达的页面（与左侧导航同源，规划中项不收录）。 */
const paletteCommands: PaletteCommand[] = [
  { label: '首页 · 管理驾驶舱', route: 'management' },
  { label: '数据接入', route: 'ingestion' },
  { label: '数据资产', route: 'assets' },
  { label: '数据治理 · 驾驶舱', route: 'governance' },
  { label: '数据治理 · 质量闭环', route: 'quality', hint: '/governance/quality' },
  { label: '主索引与主数据', route: 'mpi' },
  { label: '数据服务', route: 'dataServices' },
  { label: '分析看板', route: 'analytics' },
  { label: 'AI Data', route: 'aiData' },
  { label: '智能问数', route: 'assistant' },
  { label: '平台运维', route: 'operations' },
]

export function App() {
  const [route, setRoute] = useState<RouteKey>(() => routeFromPath(window.location.pathname))
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [auth, setAuth] = useState<AuthSnapshot>(() => oidcIsConfigured() ? { status: 'loading' } : { status: 'disabled' })

  useEffect(() => {
    let active = true
    void initializeOidc().then(snapshot => {
      if (active) setAuth(snapshot)
    })
    const handleUnauthorized = () => {
      clearOidcSession()
      setAuth({ status: 'unauthenticated' })
    }
    const handleOidcError = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail
      setAuth({ status: 'error', error: detail || 'OIDC 登录失败' })
    }
    window.addEventListener('dataos:auth-required', handleUnauthorized)
    window.addEventListener('dataos:oidc-error', handleOidcError)
    return () => {
      active = false
      window.removeEventListener('dataos:auth-required', handleUnauthorized)
      window.removeEventListener('dataos:oidc-error', handleOidcError)
    }
  }, [])

  useEffect(() => {
    function handlePopState() {
      setRoute(routeFromPath(window.location.pathname))
      setDrawerOpen(false)
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 3200)
    return () => window.clearTimeout(timer)
  }, [notice])

  // 全局命令面板（⌘K / Ctrl+K）：输入框聚焦时不抢占（面板自身另有 Esc 处理）。
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  if (auth.status !== 'disabled' && auth.status !== 'authenticated') {
    return <OidcLoginGate snapshot={auth} />
  }

  function navigate(nextRoute: RouteKey) {
    if (nextRoute === route) return
    window.history.pushState({}, '', routePaths[nextRoute])
    setRoute(nextRoute)
    setDrawerOpen(false)
    window.scrollTo({ top: 0, behavior: 'auto' })
  }

  function showUnavailable(label: string) {
    setNotice(`${label}尚未接入真实服务；当前可用的是数据接入、治理驾驶舱和质量闭环。演示模块需显式启用 VITE_DATAOS_DEMO_MODE`)
  }

  const technicalAccess = hasTechnicalAccess(auth)

  let page
  switch (route) {
    case 'ingestion':
      page = <DataIngestionPage onNotice={setNotice} onUnavailable={showUnavailable} onNavigate={navigate} />
      break
    case 'governance':
      page = <GovernanceDashboardPage onOpenChain={() => setDrawerOpen(true)} onNavigate={navigate} onUnavailable={showUnavailable} onNotice={setNotice} />
      break
    case 'standards':
      page = <DataStandardsPage onNavigate={navigate} onUnavailable={showUnavailable} onNotice={setNotice} />
      break
    case 'mapping':
      page = <StandardMappingPage onNavigate={navigate} onUnavailable={showUnavailable} onNotice={setNotice} />
      break
    case 'quality':
      page = <QualityIssuesPage onNavigate={navigate} onUnavailable={showUnavailable} onNotice={setNotice} />
      break
    case 'mpi':
      page = <MpiReviewPage onNotice={setNotice} onNavigate={navigate} />
      break
    case 'assets':
      page = <AssetCatalogPage onNotice={setNotice} onNavigate={navigate} />
      break
    case 'assetTechnical':
      page = <AssetTechnicalPage onNotice={setNotice} />
      break
    case 'analytics':
      page = <AnalyticsPage onNotice={setNotice} onNavigate={navigate} />
      break
    case 'aiData':
      page = <AIDataPage onNotice={setNotice} />
      break
    case 'dataServices':
      page = <DataServicesPage onNotice={setNotice} />
      break
    case 'assistant':
      page = <AssistantPage onNotice={setNotice} onNavigate={navigate} />
      break
    case 'assistantWorkspace':
      page = <AssistantPage onNotice={setNotice} onNavigate={navigate} professional />
      break
    case 'operationsCenter':
      page = <OperationsCenterPage onNotice={setNotice} onNavigate={navigate} />
      break
    case 'operations':
      page = <PlatformOperationsPage canAccess={technicalAccess} />
      break
    default:
      page = <ManagementDashboardPage onOpenChain={() => setDrawerOpen(true)} onNotice={setNotice} onNavigate={navigate} />
  }

  return (
    <AppShell route={route} onNavigate={navigate} onUnavailable={showUnavailable}
      authDisplayName={auth.displayName} onLogout={oidcIsConfigured() ? logoutOidc : undefined}
      technicalAccess={technicalAccess}>
      {page}
      <ResponsibilityDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} onAction={setNotice} />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onNavigate={navigate}
        commands={paletteCommands.filter((command) => command.route !== 'operations' || technicalAccess)}
      />
      {notice ? <Toast message={notice} onClose={() => setNotice('')} /> : null}
    </AppShell>
  )
}
