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
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ControlPlaneError, fetchPlatformOperations, type PlatformOperationsApiResponse, type PlatformServiceApiItem } from '../data/controlPlane'
import { Button, StatusTag } from '../components/ui/Primitives'
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
      if (cause instanceof ControlPlaneError && cause.status === 403) {
        setState('forbidden')
        setError('当前身份未被授予技术域访问权限')
        return
      }
      setState('error')
      setError(cause instanceof Error ? cause.message : '平台组件状态暂时不可用')
    }
  }, [canAccess])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    const timer = window.setInterval(() => void load(), 30_000)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [load])

  if (!canAccess || state === 'forbidden') return <AccessDenied />

  const upCount = payload?.services.filter(service => service.status === 'UP').length ?? 0
  const configuredCount = payload?.services.filter(service => service.status !== 'NOT_CONFIGURED').length ?? 0
  const checkedAt = payload?.checkedAt ? formatTime(payload.checkedAt) : '尚未检查'
  const operationalLabel = payload?.operational.state === 'READY'
    ? '核心链路就绪'
    : payload?.operational.state === 'DEGRADED' ? '核心链路降级' : '核心链路未知'

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <div className={styles.eyebrow}><ServerCog size={14} />技术域 · 平台组件</div>
          <h1>平台运维舱</h1>
          <p>把底层组件留在技术域，把业务结果留在业务域。这里集中查看执行器运行态，并进入受控的组件管理界面。</p>
          <div className={styles.heroMeta}>
            <span><ShieldCheck size={14} />仅技术角色可见</span>
            <span><LockKeyhole size={14} />不展示凭据与内部连接信息</span>
          </div>
        </div>
        <div className={styles.heroStatus}>
          <div className={styles.heroStatusLabel}>平台探针</div>
          <strong>{payload ? `${upCount}/${payload.services.length}` : '—'}</strong>
          <span>{payload ? operationalLabel : '等待首次检查'}</span>
          <button className={styles.refreshButton} onClick={() => void load()} aria-label="刷新平台组件状态">
            <RefreshCw size={15} />刷新
          </button>
        </div>
      </section>

      {state === 'error' ? (
        <section className={styles.alert} role="alert">
          <div><strong>平台状态暂时不可用</strong><span>{error}</span></div>
          <Button variant="secondary" onClick={() => void load()}>重新检查</Button>
        </section>
      ) : null}

      <section className={styles.summaryStrip} aria-label="平台组件摘要">
        <div><span>已配置组件</span><strong>{configuredCount}<small> / 3</small></strong></div>
        <div><span>当前健康</span><strong className={upCount === configuredCount && configuredCount > 0 ? styles.healthyNumber : styles.warningNumber}>{upCount}</strong></div>
        <div><span>最后检查</span><strong className={styles.timeValue}>{checkedAt}</strong></div>
        <div><span>访问角色</span><strong className={styles.roleValue}>技术人员</strong></div>
      </section>

      <section className={styles.sectionHeader}>
        <div><div className={styles.sectionKicker}>SERVICE MATRIX</div><h2>组件运行态</h2></div>
        <span>每 30 秒自动刷新 · 状态由控制面服务端探针汇总</span>
      </section>

      <section className={styles.serviceGrid} aria-label="平台组件状态">
        {(payload?.services ?? placeholderServices).map(service => <ServiceCard key={service.key} service={service} />)}
      </section>

      <section className={styles.bottomGrid}>
        <div className={styles.boundaryPanel}>
          <div className={styles.panelTitle}><ShieldCheck size={17} /><h2>访问边界</h2><StatusTag tone="healthy">已启用</StatusTag></div>
          <p>平台运维入口仅向具备以下 OIDC 角色的技术人员开放。甲方业务账号不会看到此菜单，直接访问路由也会被控制面拒绝。</p>
          <div className={styles.roleLine}><span>允许角色</span><code>{roleLabel}</code></div>
          <div className={styles.roleLine}><span>数据范围</span><code>仅组件元数据、健康状态与受控入口</code></div>
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
  )
}

function ServiceCard({ service }: { service: PlatformServiceApiItem }) {
  const Icon = iconByService[service.key]
  const isUp = service.status === 'UP'
  const isConfigured = service.status !== 'NOT_CONFIGURED'
  const tone = isUp ? 'healthy' : isConfigured ? 'warning' : 'neutral'
  const statusLabel = isUp ? '运行正常' : isConfigured ? '检查失败' : '未配置'
  return (
    <article className={`${styles.serviceCard} ${isUp ? styles.serviceCardUp : ''}`}>
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
      <div className={styles.eyebrow}>TECHNICAL DOMAIN</div>
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
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return '—'
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date)
}
