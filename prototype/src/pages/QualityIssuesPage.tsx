import { Play, Search, Send } from 'lucide-react'
import { useMemo, useState } from 'react'
import { GovernanceTabs } from '../components/ui/GovernanceTabs'
import { PageHeader } from '../components/ui/PageHeader'
import { Button, StatusTag } from '../components/ui/Primitives'
import { qualityIssues } from '../data/mock'
import type { QualityIssue, RouteKey } from '../types'
import styles from './Pages.module.css'

interface Props {
  onNavigate: (route: RouteKey) => void
  onUnavailable: (label: string) => void
  onNotice: (message: string) => void
}

export function QualityIssuesPage({ onNavigate, onUnavailable, onNotice }: Props) {
  const [selectedId, setSelectedId] = useState(qualityIssues[0].id)
  const [statusOverride, setStatusOverride] = useState<string | null>(null)
  const [note, setNote] = useState('已核对 LIS 接口日志，补数任务完成，准备发起规则复检。')
  const [query, setQuery] = useState('')
  const selected = qualityIssues.find((issue) => issue.id === selectedId) ?? qualityIssues[0]
  const displayStatus = statusOverride ?? selected.status
  const visibleIssues = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return keyword ? qualityIssues.filter((issue) => `${issue.id}${issue.title}${issue.department}`.toLowerCase().includes(keyword)) : qualityIssues
  }, [query])

  function selectIssue(issue: QualityIssue) {
    setSelectedId(issue.id)
    setStatusOverride(null)
  }

  function startRetest() {
    setStatusOverride('复检中')
    onNotice('复检任务已提交，预计 2 分钟完成')
  }

  return (
    <div className={styles.page}>
      <PageHeader title="数据质量闭环" compact />
      <GovernanceTabs route="quality" onNavigate={onNavigate} onUnavailable={onUnavailable} />
      <div className={styles.workspace}>
        <aside className={styles.workspaceRail}>
          <div className={styles.sectionTitle}><h2>问题队列</h2><span>23 待闭环</span></div>
          <div className={styles.search}><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索问题或责任部门" aria-label="搜索质量问题" /></div>
          <ul className={styles.queue}>
            {visibleIssues.map((issue) => <li key={issue.id}><button className={selected.id === issue.id ? styles.selected : ''} onClick={() => selectIssue(issue)}><span className={styles.queueTop}><span className={styles.queueId}>{issue.id}</span><StatusTag tone={issue.severity === '高' ? 'danger' : issue.severity === '中' ? 'warning' : 'neutral'}>{issue.severity}风险</StatusTag></span><span className={styles.queueTitle}>{issue.title}</span><span className={styles.queueMeta}>{issue.department} · {issue.dueAt}</span></button></li>)}
            {visibleIssues.length === 0 ? <li className={styles.emptyState}>未找到匹配的质量问题</li> : null}
          </ul>
        </aside>
        <section className={styles.workspaceMain}>
          <div className={styles.detailHero}>
            <StatusTag tone={displayStatus === '复检中' ? 'healthy' : 'warning'}>{displayStatus}</StatusTag>
            <h2>{selected.title}</h2><p>{selected.id} · {selected.object}</p>
            <div className={styles.detailActions}><Button variant="primary" onClick={startRetest} disabled={displayStatus === '复检中'}><Play size={14} />{displayStatus === '复检中' ? '正在复检' : '开始复检'}</Button><Button onClick={() => onNotice('已通知责任人并记录发送时间')}>提醒责任人</Button></div>
          </div>
          <ol className={styles.timeline}>
            {displayStatus === '复检中' ? <li><time>08-01 14:32</time><div><strong>已发起自动复检</strong><p>按原规则重跑受影响分区，结果将自动回写当前工单。</p></div></li> : null}
            <li><time>08-01 11:20</time><div><strong>责任人提交处理结果</strong><p>完成 LIS 接口配置修正与历史缺失数据补采，等待复检。</p></div></li>
            <li><time>08-01 09:42</time><div><strong>治理负责人完成分派</strong><p>责任部门：{selected.department}；SLA：{selected.dueAt}。</p></div></li>
            <li><time>07-31 09:23</time><div><strong>质量规则首次发现异常</strong><p>{selected.rule}</p></div></li>
          </ol>
        </section>
        <aside className={styles.workspaceInspector}>
          <div className={styles.sectionTitle}><h3>影响与证据</h3><StatusTag tone="danger">{selected.severity}风险</StatusTag></div>
          <div className={styles.evidenceBox}><h3>影响范围</h3><p>{selected.impact}</p></div>
          <div className={styles.evidenceBox}><h3>规则证据</h3><p>{selected.rule}<br />最近执行：08-01 14:26<br />规则结果来源：质量规则运行结果</p></div>
          <div className={styles.evidenceBox}><h3>责任归属</h3><p>{selected.department}<br />来源：资产责任人与组织主数据</p></div>
          <div className={styles.noteBox}>
            <label htmlFor="processing-note">处理说明</label>
            <textarea id="processing-note" value={note} onChange={(event) => setNote(event.target.value)} />
            <div className={styles.noteActions}><Button variant="primary" onClick={() => onNotice('处理说明已保存到治理工单')} disabled={!note.trim()}><Send size={14} />提交说明</Button></div>
          </div>
        </aside>
      </div>
    </div>
  )
}
