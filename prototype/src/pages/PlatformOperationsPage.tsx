import {
  Activity,
  ArrowUpRight,
  Boxes,
  Database,
  LockKeyhole,
  RefreshCw,
  ServerCog,
  ShieldCheck,
  Workflow,
} from 'lucide-react'
import { useCallback, useState } from 'react'
import { fetchPlatformOperations, type PlatformOperationsApiResponse, type PlatformServiceApiItem } from '../data/controlPlane'
import { PortalHttpError } from '../data/http'
import { usePolling } from '../hooks/usePolling'
import { Button, StatusTag } from '../components/ui/Primitives'
import { PageHeader } from '../components/ui/PageHeader'
import { formatDateTime } from '../data/domain'
import styles from './PlatformOperationsPage.module.css'

const iconByService = {
  seatunnel: Activity,
  dolphinscheduler: Workflow,
  rustfs: Boxes,
} as const

const roleLabel = 'DATA_ENGINEER · PLATFORM_OPERATOR · PLATFORM_ADMIN'

export function PlatformOperationsPage({ canAccess }: { canAccess: boolean }) {
  const [payload, setPayload] = useState<PlatformOperationsApiResponse | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error' | 'forbidden'>('idle')
  const [error, setError] = useState('')

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!canAccess) return
    setState(current => current === 'ready' ? current : 'loading')
    try {
      const next = await fetchPlatformOperations(signal)
      setPayload(next)
      setError('')
      setState('ready')
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      if (cause instanceof PortalHttpError && cause.status === 403) {
        setState('forbidden')
        setError('当前身份未被授予技术域访问权限')
        return
      }
      setState('error')
      setError(cause instanceof Error ? cause.message : '平台组件状态暂时不可用')
    }
  }, [canAccess])

  // 周期刷新（30 秒探针）；403/错误语义留在 load 回调内。
  usePolling(load, 30_000, canAccess)

  if (!canAccess || state === 'forbidden') return <AccessDenied />

  const firstProbePending = !payload && (state === 'idle' || state === 'loading')
  const upCount = payload?.services.filter(service => service.status === 'UP').length ?? 0
  const configuredCount = payload?.services.filter(service => service.status !== 'NOT_CONFIGURED').length ?? 0
  const totalComponents = payload?.services.length ?? placeholderServices.length
  const checkedAt = payload?.checkedAt ? formatTime(payload.checkedAt) : '尚未检查'
  const operationalLabel = payload?.operational.state === 'READY'
    ? '核心链路就绪'
    : payload?.operational.state === 'DEGRADED' ? '核心链路降级' : '核心链路未知'

  return (
    <div className={styles.page}>
      <PageHeader
        title="平台运维舱"
        eyebrow="技术域 · 平台组件"
        subtitle="把底层组件留在技术域，把业务结果留在业务域。这里集中查看执行器运行态，并进入受控的组件管理界面。"
        compact
        asOf={payload?.checkedAt ?? null}
      />
      <div className={styles.pageBody}>
        <section className={styles.probeBar} aria-label="平台探针摘要">
          <div className={styles.probeStatus}>
            <span className={styles.probeDot} data-ready={payload?.operational.state === 'READY'} />
            <div>
              <strong>{payload ? operationalLabel : firstProbePending ? '正在执行首次探针…' : '等待首次检查'}</strong>
              <span>30 秒自动刷新 · 状态由控制面服务端探针汇总</span>
            </div>
          </div>
          <dl className={styles.probeFacts}>
            <div><dt>已配置组件</dt><dd>{payload ? `${configuredCount} / ${totalComponents}` : '—'}</dd></div>
            <div><dt>当前健康</dt><dd className={upCount === configuredCount && configuredCount > 0 ? styles.healthyNumber : styles.warningNumber}>{payload ? upCount : '—'}</dd></div>
            <div><dt>最后检查</dt><dd>{checkedAt}</dd></div>
          </dl>
          <div className={styles.probeActions}>
            <span className={styles.probeBoundary} title="平台运维入口仅向技术角色开放"><ShieldCheck size={13} aria-hidden="true" />仅技术角色可见</span>
            <Button variant="secondary" onClick={() => void load()}><RefreshCw size={13} />刷新</Button>
          </div>
        </section>

        {state === 'error' ? (
          <section className={styles.alert} role="alert">
            <div><strong>平台状态暂时不可用</strong><span>{error}</span></div>
            <Button variant="secondary" onClick={() => void load()}>重新检查</Button>
          </section>
        ) : null}

        <section className={styles.sectionHeader}>
          <div><h2>组件运行态</h2></div>
        </section>

        <section className={styles.serviceGrid} aria-label="平台组件状态">
          {(payload?.services ?? placeholderServices).map(service => <ServiceCard key={service.key} service={service} pending={firstProbePending} />)}
        </section>

        <section className={styles.bottomGrid}>
          <div className={styles.boundaryPanel}>
            <div className={styles.panelTitle}><ShieldCheck size={17} /><h2>访问边界</h2><StatusTag tone="healthy">已启用</StatusTag></div>
            <p>平台运维入口仅向具备以下 OIDC 角色的技术人员开放。甲方业务账号不会看到此菜单，直接访问路由也会被控制面拒绝。</p>
            <div className={styles.roleLine}><span>允许角色</span><code>{roleLabel}</code></div>
            <div className={styles.roleLine}><span>数据范围</span><code>仅组件元数据、健康状态与受控入口</code></div>
            <div className={styles.roleLine}><span>数据边界</span><code>不保存、不回显 Token、Secret 或患者数据</code></div>
          </div>
          <div className={styles.guidePanel}>
            <div className={styles.panelTitle}><Database size={17} /><h2>使用提示</h2></div>
            <ul>
              <li>SeaTunnel 只在这里呈现执行器状态；采集任务仍从“数据接入”发起。</li>
              <li>DolphinScheduler 与 RustFS 在新标签页打开，沿用院内技术域网络策略。</li>
              <li>门户不保存、不回显 Token、Secret、患者数据或内部连接串。</li>
            </ul>
          </div>
        </section>
      </div>
    </div>
  )
}

function ServiceCard({ service, pending = false }: { service: PlatformServiceApiItem; pending?: boolean }) {
  const Icon = iconByService[service.key]
  const isUp = service.status === 'UP'
  const isConfigured = service.status !== 'NOT_CONFIGURED'
  const tone = isUp ? 'healthy' : isConfigured ? 'warning' : 'neutral'
  // 探针未返回前是「检查中」，不得把加载态说成「未配置」。
  const statusLabel = pending ? '检查中' : isUp ? '运行正常' : isConfigured ? '检查失败' : '未配置'
  return (
    <article className={styles.serviceCard}>
      <div className={styles.serviceTopline}>
        <div className={styles.serviceIdentity}><span className={styles.serviceIcon}><Icon size={19} /></span><div><h3>{service.name}</h3><span>{service.role}</span></div></div>
        <StatusTag tone={tone}>{statusLabel}</StatusTag>
      </div>
      <p className={styles.serviceDescription}>{service.description}</p>
      <div className={styles.serviceRule} />
      <dl className={styles.metrics}>
        {Object.entries(service.metrics).slice(0, 3).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        <div><dt>最近检查</dt><dd>{formatTime(service.checkedAt)}</dd></div>
      </dl>
      <div className={styles.serviceFoot}>
        <span className={`${styles.signal} ${isUp ? styles.signalUp : ''}`}><i />{service.detail}</span>
        {service.uiUrl ? <a className={styles.externalLink} href={service.uiUrl} target="_blank" rel="noreferrer">打开技术入口<ArrowUpRight size={14} /></a> : <span className={styles.noEntry}>无独立 UI · 使用门户编排</span>}
      </div>
    </article>
  )
}

function AccessDenied() {
  return (
    <div className={styles.deniedPage}>
      <div className={styles.deniedIcon}><LockKeyhole size={24} /></div>
      <h1>此区域仅面向技术人员</h1>
      <p>平台组件入口不对业务与甲方账号开放。请使用具备 <code>data-engineer</code>、<code>platform-operator</code> 或 <code>platform-admin</code> 角色的账号登录。</p>
    </div>
  )
}

const placeholderServices: PlatformServiceApiItem[] = [
  { key: 'seatunnel', name: 'SeaTunnel', role: '采集执行器', status: 'NOT_CONFIGURED', description: '中心采集任务的运行态与版本信息。', checkedAt: new Date(0).toISOString(), detail: '等待控制面返回状态', uiUrl: null, metrics: {} },
  { key: 'dolphinscheduler', name: 'DolphinScheduler', role: '编排调度器', status: 'NOT_CONFIGURED', description: '已发布工作流、调度实例与补数编排的技术入口。', checkedAt: new Date(0).toISOString(), detail: '等待控制面返回状态', uiUrl: null, metrics: {} },
  { key: 'rustfs', name: 'RustFS', role: 'S3 制品存储', status: 'NOT_CONFIGURED', description: '质量证据与运行制品的 S3 兼容对象存储。', checkedAt: new Date(0).toISOString(), detail: '等待控制面返回状态', uiUrl: null, metrics: {} },
]

function formatTime(value: string): string {
  if (!value || value === new Date(0).toISOString()) return '—'
  return formatDateTime(value)
}
