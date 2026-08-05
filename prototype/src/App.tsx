import { useEffect, useState } from 'react'
import { ResponsibilityDrawer } from './components/governance/ResponsibilityChain'
import { AppShell } from './components/layout/AppShell'
import { Toast } from './components/ui/Primitives'
import { routePaths } from './data/mock'
import { DataStandardsPage } from './pages/DataStandardsPage'
import { DataIngestionPage } from './pages/DataIngestionPage'
import { AnalyticsPage } from './pages/AnalyticsPage'
import { AssetCatalogPage } from './pages/AssetCatalogPage'
import { AssetTechnicalPage } from './pages/AssetTechnicalPage'
import { AssistantPage } from './pages/AssistantPage'
import { GovernanceDashboardPage } from './pages/GovernanceDashboardPage'
import { ManagementDashboardPage } from './pages/ManagementDashboardPage'
import { MpiReviewPage } from './pages/MpiReviewPage'
import { QualityIssuesPage } from './pages/QualityIssuesPage'
import { StandardMappingPage } from './pages/StandardMappingPage'
import type { RouteKey } from './types'

function routeFromPath(pathname: string): RouteKey {
  const exact = (Object.entries(routePaths) as [RouteKey, string][]).find(([, path]) => path === pathname)
  return exact?.[0] ?? 'management'
}

export function App() {
  const [route, setRoute] = useState<RouteKey>(() => routeFromPath(window.location.pathname))
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [notice, setNotice] = useState('')

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

  function navigate(nextRoute: RouteKey) {
    if (nextRoute === route) return
    window.history.pushState({}, '', routePaths[nextRoute])
    setRoute(nextRoute)
    setDrawerOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function showUnavailable(label: string) {
    setNotice(`${label}尚未接入真实服务；当前可用的是数据接入、治理驾驶舱和质量闭环。演示模块需显式启用 VITE_DATAOS_DEMO_MODE`)
  }

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
    case 'assistant':
      page = <AssistantPage onNotice={setNotice} onNavigate={navigate} />
      break
    case 'assistantWorkspace':
      page = <AssistantPage onNotice={setNotice} onNavigate={navigate} professional />
      break
    default:
      page = <ManagementDashboardPage onOpenChain={() => setDrawerOpen(true)} onUnavailable={showUnavailable} onNotice={setNotice} onNavigate={navigate} />
  }

  return (
    <AppShell route={route} onNavigate={navigate} onUnavailable={showUnavailable}>
      {page}
      <ResponsibilityDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} onAction={setNotice} />
      {notice ? <Toast message={notice} onClose={() => setNotice('')} /> : null}
    </AppShell>
  )
}
