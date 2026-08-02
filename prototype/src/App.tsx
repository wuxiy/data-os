import { useEffect, useState } from 'react'
import { ResponsibilityDrawer } from './components/governance/ResponsibilityChain'
import { AppShell } from './components/layout/AppShell'
import { Toast } from './components/ui/Primitives'
import { routePaths } from './data/mock'
import { DataStandardsPage } from './pages/DataStandardsPage'
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
    setNotice(`${label}将在下一版接入；当前可体验治理与主索引核心流程`)
  }

  let page
  switch (route) {
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
      page = <MpiReviewPage onNotice={setNotice} />
      break
    default:
      page = <ManagementDashboardPage onOpenChain={() => setDrawerOpen(true)} onUnavailable={showUnavailable} onNotice={setNotice} />
  }

  return (
    <AppShell route={route} onNavigate={navigate} onUnavailable={showUnavailable}>
      {page}
      <ResponsibilityDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} onAction={setNotice} />
      {notice ? <Toast message={notice} onClose={() => setNotice('')} /> : null}
    </AppShell>
  )
}
