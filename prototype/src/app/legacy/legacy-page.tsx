import { App as AntdApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { useCallback, useState, type ReactNode } from 'react'
import { ResponsibilityDrawer } from '../../components/governance/ResponsibilityChain'
import { useNotice } from '../../components/ui/toast'
import { dataOsTheme } from '../../theme'
import { useAuth } from '../providers'
import { usePortalNavigate } from '../navigate'
import { routePaths } from '../../data/routes'
import type { RouteKey } from '../../types'
import { DataIngestionPage } from '../../pages/DataIngestionPage'
import { GovernanceDashboardPage } from '../../pages/GovernanceDashboardPage'
import { DataStandardsPage } from '../../pages/DataStandardsPage'
import { StandardMappingPage } from '../../pages/StandardMappingPage'
import { QualityIssuesPage } from '../../pages/QualityIssuesPage'
import { MpiReviewPage } from '../../pages/MpiReviewPage'
import { AssetCatalogPage } from '../../pages/AssetCatalogPage'
import { AssetTechnicalPage } from '../../pages/AssetTechnicalPage'
import { AnalyticsPage } from '../../pages/AnalyticsPage'
import { AIDataPage } from '../../pages/AIDataPage'
import { DataServicesPage } from '../../pages/DataServicesPage'
import { AssistantPage } from '../../pages/AssistantPage'
import { OperationsCenterPage } from '../../pages/OperationsCenterPage'
import { DeliveryCenterPage } from '../../pages/DeliveryCenterPage'
import { PlatformOperationsPage } from '../../pages/PlatformOperationsPage'
import { ManagementDashboardPage } from '../../pages/ManagementDashboardPage'

const getPopupContainer = () => document.getElementById('legacy-overlay') ?? document.body

/**
 * 旧页面兼容边界（FE1）：迁移期间 antd 页面与新壳共存。
 * v3 主题只作用于 #legacy-root，antd 弹层挂到 #legacy-overlay，新组件不受污染。
 * 每迁完一个业务域就移除对应分支，FE7 删除本文件与全部旧页面。
 */
export function LegacyRoute({ page }: { page: ReactNode }) {
  return (
    <div id="legacy-root" data-legacy-root="">
      <ConfigProvider locale={zhCN} theme={dataOsTheme} button={{ autoInsertSpace: false }} getPopupContainer={getPopupContainer} getTargetContainer={getPopupContainer}>
        <AntdApp>{page}</AntdApp>
      </ConfigProvider>
      <div id="legacy-overlay" />
    </div>
  )
}

type LegacyRouteKey = Exclude<RouteKey, never>

/** 旧页面的依赖注入点：提示、导航与不可用口径统一走新壳。 */
export function LegacyPortalPage({ route }: { route: LegacyRouteKey }) {
  const navigate = usePortalNavigate()
  const notify = useNotice()
  const { assistantGovernance, technicalAccess } = useAuth()
  const [drawerOpen, setDrawerOpen] = useState(false)

  const onNavigate = useCallback((key: RouteKey) => {
    navigate(routePaths[key])
  }, [navigate])

  const onNotice = useCallback((message: string) => notify(message), [notify])

  const onUnavailable = useCallback((label: string) => {
    notify(`${label}尚未接入真实服务；当前可用的是数据接入、治理驾驶舱和质量闭环。演示模块需显式启用 VITE_DATAOS_DEMO_MODE`)
  }, [notify])

  let page: ReactNode
  switch (route) {
    case 'ingestion':
      page = <DataIngestionPage onNotice={onNotice} onUnavailable={onUnavailable} onNavigate={onNavigate} />
      break
    case 'governance':
      page = <GovernanceDashboardPage onOpenChain={() => setDrawerOpen(true)} onNavigate={onNavigate} onUnavailable={onUnavailable} onNotice={onNotice} />
      break
    case 'standards':
      page = <DataStandardsPage onNavigate={onNavigate} onUnavailable={onUnavailable} onNotice={onNotice} />
      break
    case 'mapping':
      page = <StandardMappingPage onNavigate={onNavigate} onUnavailable={onUnavailable} onNotice={onNotice} />
      break
    case 'quality':
      page = <QualityIssuesPage onNavigate={onNavigate} onUnavailable={onUnavailable} onNotice={onNotice} />
      break
    case 'mpi':
      page = <MpiReviewPage onNotice={onNotice} onNavigate={onNavigate} />
      break
    case 'assets':
      page = <AssetCatalogPage onNotice={onNotice} onNavigate={onNavigate} />
      break
    case 'assetTechnical':
      page = <AssetTechnicalPage onNotice={onNotice} />
      break
    case 'analytics':
      page = <AnalyticsPage onNotice={onNotice} onNavigate={onNavigate} />
      break
    case 'aiData':
      page = <AIDataPage onNotice={onNotice} />
      break
    case 'dataServices':
      page = <DataServicesPage onNotice={onNotice} onNavigate={onNavigate} onUnavailable={onUnavailable} />
      break
    case 'assistant':
      page = <AssistantPage onNotice={onNotice} onNavigate={onNavigate} />
      break
    case 'assistantWorkspace':
      page = <AssistantPage onNotice={onNotice} onNavigate={onNavigate} professional governance={assistantGovernance} />
      break
    case 'operationsCenter':
      page = <OperationsCenterPage onNotice={onNotice} onNavigate={onNavigate} />
      break
    case 'deliveryCenter':
      page = <DeliveryCenterPage onNotice={onNotice} />
      break
    case 'operations':
      page = <PlatformOperationsPage canAccess={technicalAccess} />
      break
    default:
      page = <ManagementDashboardPage onOpenChain={() => setDrawerOpen(true)} onNotice={onNotice} onNavigate={onNavigate} />
  }

  return (
    <LegacyRoute page={
      <>
        {page}
        <ResponsibilityDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} onAction={onNotice} />
      </>
    } />
  )
}
