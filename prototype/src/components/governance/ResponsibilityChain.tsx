import {
  AlertCircle,
  CheckCircle2,
  Database,
  ExternalLink,
  FileCheck2,
  RefreshCcw,
  Users,
  X,
} from 'lucide-react'
import { useEffect } from 'react'
import { Button } from '../ui/Primitives'
import { frontendDemoMode } from '../../data/runtime'
import styles from './ResponsibilityChain.module.css'

const demoNodes = [
  {
    label: '异常发现',
    value: '门诊诊断编码存在失效值',
    detail: '首次发现 07-31 09:23',
    source: '质量规则运行结果',
    icon: AlertCircle,
    tone: 'warning',
  },
  {
    label: '数据对象',
    value: '门诊就诊事实表 · diagnosis_code',
    detail: '影响 428 条记录',
    source: '资产目录与采集元数据',
    icon: Database,
  },
  {
    label: '治理规则',
    value: '诊断编码有效值域规则',
    detail: '规则类型 · 值域有效性',
    source: '质量规则中心',
    icon: FileCheck2,
  },
  {
    label: '责任部门',
    value: '门诊部数据管理员',
    detail: '责任人 · 王敏',
    source: '资产责任人与组织主数据',
    icon: Users,
  },
  {
    label: '处理结果',
    value: '待复检',
    detail: '更新 08-01 11:20',
    source: '治理工单',
    icon: CheckCircle2,
    tone: 'danger',
  },
]

const nodes = frontendDemoMode ? demoNodes : []

interface ResponsibilityChainProps {
  onOpen: () => void
}

export function ResponsibilityChain({ onOpen }: ResponsibilityChainProps) {
  return (
    <section className={styles.chainPanel} aria-labelledby="responsibility-chain-title">
      <div className={styles.chainHeader}>
        <div>
          <h2 id="responsibility-chain-title">治理责任链</h2>
          <p>异常不是结果，责任与处理动作必须可追溯</p>
        </div>
        <div className={styles.sourceSummary}>
          <span>来源：{frontendDemoMode ? <><b>质量事件 DQ-20260801-023</b></> : '真实问题事件待绑定'}</span>
          <span>{frontendDemoMode ? '生成 08-01 14:26 · 刷新 14:30' : '等待真实溯源服务'}</span>
          <button onClick={onOpen}>查看来源 <ExternalLink size={13} /></button>
        </div>
      </div>
      <button className={styles.chainTrack} onClick={onOpen} aria-label="打开治理责任链详情">
        {nodes.map((node, index) => {
          const Icon = node.icon
          return (
            <div className={styles.chainStep} key={node.label}>
              <div className={styles.stepTitle}><Icon size={18} /><span>{node.label}</span></div>
              <div className={`${styles.stepValue} ${node.tone ? styles[node.tone] : ''}`} title={node.value}>{node.value}</div>
              {index < nodes.length - 1 ? <span className={styles.connector} aria-hidden="true" /> : null}
            </div>
          )
        })}
      </button>
    </section>
  )
}

interface ResponsibilityDrawerProps {
  open: boolean
  onClose: () => void
  onAction: (message: string) => void
}

export function ResponsibilityDrawer({ open, onClose, onAction }: ResponsibilityDrawerProps) {
  useEffect(() => {
    if (!open) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  return (
    <>
      <div className={`${styles.drawerBackdrop} ${open ? styles.drawerBackdropOpen : ''}`} onClick={onClose} aria-hidden="true" />
      <aside className={`${styles.drawer} ${open ? styles.drawerOpen : ''}`} aria-hidden={!open} aria-label="责任链详情">
        <div className={styles.drawerHeader}>
          <div>
            <span>数据治理 / 质量事件</span>
            <h2>责任链详情</h2>
          </div>
          <button onClick={onClose} aria-label="关闭责任链详情"><X size={21} /></button>
        </div>
        <div className={styles.provenance}>
          <dl>
            <div><dt>链路编号</dt><dd>{frontendDemoMode ? 'RC-20260801-023' : '待真实事件绑定'}</dd></div>
            <div><dt>关联方式</dt><dd>{frontendDemoMode ? 'issueId → assetId → ruleId → ownerId → ticketId' : '等待问题、资产、规则和责任人 API'}</dd></div>
            <div><dt>最近刷新</dt><dd>{frontendDemoMode ? '08-01 14:30' : '—'}</dd></div>
          </dl>
          <Button variant="quiet" onClick={() => onAction('责任链已刷新，节点来源与 08-01 14:30 快照一致')}><RefreshCcw size={14} />刷新链路</Button>
        </div>
        <div className={styles.drawerNodes}>
          {nodes.map((node, index) => {
            const Icon = node.icon
            return (
              <article className={styles.drawerNode} key={node.label}>
                <div className={`${styles.nodeIcon} ${node.tone ? styles[node.tone] : ''}`}><Icon size={19} /></div>
                <div className={styles.nodeContent}>
                  <span className={styles.nodeIndex}>0{index + 1} · {node.label}</span>
                  <h3>{node.value}</h3>
                  <p>{node.detail}</p>
                  <div className={styles.nodeSource}>来源 · {node.source}</div>
                  <Button variant="secondary" onClick={() => onAction(index === 3 ? '已打开责任人联系方式与值班安排' : index === 4 ? '已定位治理工单处理记录' : `已定位“${node.label}”来源详情`)}>{index === 3 ? '联系责任人' : index === 4 ? '处理记录' : '查看详情'}</Button>
                </div>
              </article>
            )
          })}
        </div>
      </aside>
    </>
  )
}
