import { CheckCircle2, CircleAlert, GitMerge, GitPullRequestArrow, LoaderCircle, RefreshCw, ShieldCheck, Split, XCircle } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { Button, StatusTag } from '../components/ui/Primitives'
import { Drawer } from '../components/ui/Drawer'
import { useApiResource } from '../hooks/useApiResource'
import {
  decideMpiTask,
  fetchMpiCandidates,
  fetchMpiMetrics,
  fetchMpiPerson,
  mpiEvidenceFieldLabel,
  mpiRuleLabel,
  rebuildMpi,
  splitMpiPerson,
  type MpiCandidateItem,
  type MpiDecisionResponse,
  type MpiPersonDetail,
} from '../data/mpiApi'
import { useAction } from '../hooks/useAction'
import styles from './Pages.module.css'

/**
 * 主索引复核工作台（真实数据）：候选队列 → 双侧身份对比 → 匹配证据 →
 * 同人/不同人决策（终态否决）→ 黄金人详情与拆分。数据来自 mpi-service，
 * 卡号/患者主键由服务端掩码；年龄仅展示证据。
 */
export function MpiReviewLive({ onNotice }: { onNotice: (message: string) => void }) {
  const [metrics, setMetrics] = useState<Awaited<ReturnType<typeof fetchMpiMetrics>> | null>(null)
  const [candidates, setCandidates] = useState<MpiCandidateItem[]>([])
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [personDrawerId, setPersonDrawerId] = useState<string | null>(null)
  // 动作互斥与错误归置统一（决策/重算/拆分共用一台互斥机）。
  const { pendingKey, error: decisionError, run: runAction } = useAction()

  const reload = useCallback((signal?: AbortSignal) => Promise.all([
    fetchMpiMetrics(signal),
    fetchMpiCandidates({ status: 'OPEN', size: 100 }, signal),
  ]), [])

  const apiState = useApiResource({
    load: (signal) => reload(signal),
    onData: ([metricsData, candidatesData]) => {
      setMetrics(metricsData)
      setCandidates(candidatesData.items)
      setSelectedTaskId((current) =>
        current && candidatesData.items.some((item) => item.taskId === current)
          ? current
          : candidatesData.items[0]?.taskId ?? null)
    },
    onUnavailable: () => {
      setMetrics(null)
      setCandidates([])
    },
    timeoutMs: 15000,
  })

  const selected = useMemo(
    () => candidates.find((item) => item.taskId === selectedTaskId) ?? candidates[0] ?? null,
    [candidates, selectedTaskId],
  )
  const evidence = selected?.evidence ?? []
  const visibleCandidates = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return candidates
    return candidates.filter((item) =>
      `${item.taskId}${item.identityA.name}${item.identityB.name}${item.ruleId}${item.identityA.cardNo}`.toLowerCase().includes(keyword))
  }, [candidates, query])

  async function refreshAfterAction() {
    const [metricsData, candidatesData] = await reload()
    setMetrics(metricsData)
    setCandidates(candidatesData.items)
    setSelectedTaskId(candidatesData.items[0]?.taskId ?? null)
    setConfirmed(false)
  }

  function submitDecision(resolution: 'SAME_PERSON' | 'DIFFERENT_PERSON') {
    if (!selected) return
    void runAction(`decision-${resolution}`, '决策提交失败', async () => {
      const result: MpiDecisionResponse = await decideMpiTask(
        selected.taskId, resolution, resolution === 'SAME_PERSON' ? '工作台人工确认同人' : '工作台人工确认不同人')
      await refreshAfterAction()
      if (resolution === 'SAME_PERSON' && result.mergedPersonId) {
        onNotice('已确认同一人并并入黄金记录；可在黄金人详情中拆分撤销')
        setPersonDrawerId(result.mergedPersonId)
      } else {
        onNotice('已确认不同人：该候选对不再自动进入复核（人工否决生效）')
      }
    })
  }

  function triggerRebuild() {
    void runAction('rebuild', '重算失败', async () => {
      const result = await rebuildMpi()
      onNotice(`重算完成：${result.identitiesLoaded} 身份 / ${result.candidatePairs} 候选对 / 自动匹配 ${result.outcomes.autoMatch}`)
      await refreshAfterAction()
    })
  }

  const identityRows = selected ? [
    ['姓名', selected.identityA.name, selected.identityB.name],
    ['性别', selected.identityA.gender, selected.identityB.gender],
    ['卡号（掩码）', selected.identityA.cardNo || '—', selected.identityB.cardNo || '—'],
    ['患者主键（掩码）', selected.identityA.patientId, selected.identityB.patientId],
    ['机构', selected.identityA.institution, selected.identityB.institution],
    ['源系统', selected.identityA.sourceSystem, selected.identityB.sourceSystem],
    ['年龄（仅展示）', selected.identityA.age || '—', selected.identityB.age || '—'],
  ] as Array<[string, string, string]> : []

  return (
    <div className={styles.page}>
      <div className={styles.apiStatus} role="status" aria-live="polite">
        <span className={`${styles.apiDot} ${apiState === 'live' ? styles.apiDotLive : ''}`} />
        {apiState === 'loading' ? '正在连接 MPI 服务…' : apiState === 'live' ? 'MPI 服务已连接 · 候选与决策来自 mpi-service' : 'MPI 服务暂不可用 · 不可用时不展示演示候选'}
      </div>

      {metrics ? (
        <div className={styles.metricStrip}>
          <div className={styles.metricCard}><strong>{metrics.identitiesLoaded}</strong><span>已装载源身份</span></div>
          <div className={styles.metricCard}><strong>{metrics.goldenPersons}</strong><span>黄金人</span></div>
          <div className={styles.metricCard}><strong>{metrics.autoMatches}</strong><span>自动匹配</span></div>
          <div className={styles.metricCard}><strong className={metrics.reviewPending > 0 ? undefined : undefined}>{metrics.reviewPending}</strong><span>待复核</span></div>
          <div className={styles.metricCard}><strong>{metrics.reviewResolved}</strong><span>已裁决</span></div>
        </div>
      ) : null}

      {apiState === 'unavailable' ? <div className={styles.connectionNotice} role="alert"><CircleAlert size={17} /><div><strong>MPI 服务不可用</strong><span>当前页面不展示演示候选；请恢复 mpi-service 后重新加载。</span></div><button className={styles.secondaryButton} onClick={() => window.location.reload()}>重新连接</button></div> : null}

      {apiState === 'live' ? (
        <div className={styles.mpiWorkspace}>
          <aside className={styles.workspaceRail}>
            <div className={styles.sectionTitle}><h2>候选队列</h2><span>{metrics?.reviewPending ?? candidates.length} 待复核</span></div>
            <div className={styles.search}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="姓名 / 卡号 / 规则" aria-label="搜索复核候选" /></div>
            <ul className={styles.queue}>
              {visibleCandidates.map((candidate) => (
                <li key={candidate.taskId}>
                  <button className={selected?.taskId === candidate.taskId ? styles.selected : ''} onClick={() => { setSelectedTaskId(candidate.taskId); setConfirmed(false) }}>
                    <span className={styles.queueTop}>
                      <span className={styles.queueId}>{mpiRuleLabel[candidate.ruleId] ?? candidate.ruleId}</span>
                      <StatusTag tone="warning">{candidate.ruleId}</StatusTag>
                    </span>
                    <span className={styles.queueTitle}>{candidate.identityA.name} ↔ {candidate.identityB.name}</span>
                    <span className={styles.queueMeta}>{candidate.identityA.institution} · {candidate.identityA.cardNo || '无卡号'}</span>
                  </button>
                </li>
              ))}
              {visibleCandidates.length === 0 ? <li className={styles.emptyState}>当前没有待复核候选</li> : null}
            </ul>
            <div className={styles.railActions}>
              <Button onClick={triggerRebuild} disabled={pendingKey !== null}><RefreshCw size={14} className={pendingKey === 'rebuild' ? styles.spin : undefined} />{pendingKey === 'rebuild' ? '重算中…' : '重算主索引'}</Button>
            </div>
          </aside>

          <section className={styles.mpiMain}>
            {selected ? (
              <>
                <div className={styles.mpiTop}>
                  <div>
                    <StatusTag tone="warning">需人工确认</StatusTag>
                    <h2>{selected.identityA.name} 与 {selected.identityB.name}</h2>
                    <p>{mpiRuleLabel[selected.ruleId] ?? selected.ruleId} · 候选对 {selected.pairId} · 规则版本 v1</p>
                  </div>
                </div>
                <div className={styles.compareWrap}>
                  <table className={styles.compareTable}>
                    <thead><tr><th>身份属性</th><th>源身份 A</th><th>源身份 B</th></tr></thead>
                    <tbody>
                      {identityRows.map(([field, valueA, valueB]) => (
                        <tr key={field}><td>{field}</td><td>{valueA}</td><td>{valueB}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className={styles.mpiLower}>
                  <section className={styles.panel}>
                    <div className={styles.panelHeader}><div><h3>匹配证据</h3><p>逐字段对比 · 敏感值已掩码</p></div><ShieldCheck size={18} color="var(--jade)" /></div>
                    <ul className={`${styles.checkList} ${styles.compactCheckList}`}>
                      {evidence.map((item) => (
                        <li key={item.field}>
                          {item.match ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                          {mpiEvidenceFieldLabel[item.field] ?? item.field}：{item.valueA ?? '—'} / {item.valueB ?? '—'} {item.match ? '一致' : '不一致'}
                        </li>
                      ))}
                    </ul>
                  </section>
                  <section className={styles.panel}>
                    <div className={styles.panelHeader}><div><h3>操作影响</h3><p>决策即审计，人工否决高于规则</p></div><GitMerge size={18} color="var(--jade)" /></div>
                    <dl className={`${styles.definitionList} ${styles.paddedDefinitionList}`}>
                      <div><dt>确认同人</dt><dd>两身份并入黄金人（决策源=人工），可在详情中拆分撤销</dd></div>
                      <div><dt>确认不同人</dt><dd>终态否决：该对永不再自动候选或自动合并</dd></div>
                      <div><dt>误合并防护</dt><dd>卡号复用等弱证据冲突一律进入本队列，不自动合并</dd></div>
                    </dl>
                  </section>
                </div>
                {decisionError ? <div className={styles.connectionNotice} role="alert"><CircleAlert size={17} /><div><strong>操作失败</strong><span>{decisionError}</span></div></div> : null}
                <div className={styles.mpiActions}>
                  <label className={styles.confirmCheck}>
                    <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={pendingKey !== null} />
                    <span>我已核对身份属性与证据。错误合并的临床风险高于漏合并——弱证据冲突请确认不同人。</span>
                  </label>
                  <div className={styles.actionGroup}>
                    <Button onClick={() => submitDecision('DIFFERENT_PERSON')} disabled={pendingKey !== null}><GitPullRequestArrow size={14} />确认不同人</Button>
                    <Button variant="primary" disabled={!confirmed || pendingKey !== null} onClick={() => submitDecision('SAME_PERSON')}>{pendingKey !== null ? <LoaderCircle size={14} className={styles.spin} /> : <GitMerge size={14} />}确认同人并合并</Button>
                  </div>
                </div>
              </>
            ) : (
              <div className={styles.emptyState}>当前没有待复核候选——点击左侧「重算主索引」装载最新数据</div>
            )}
          </section>
        </div>
      ) : null}

      {personDrawerId ? <MpiPersonDrawer personId={personDrawerId} onClose={() => setPersonDrawerId(null)} onNotice={onNotice} onSplit={async () => { await refreshAfterAction() }} /> : null}
    </div>
  )
}

function MpiPersonDrawer({ personId, onClose, onNotice, onSplit }: { personId: string; onClose: () => void; onNotice: (message: string) => void; onSplit: () => Promise<void> }) {
  const [person, setPerson] = useState<MpiPersonDetail | null>(null)
  const { pendingKey, error, run: runAction } = useAction()

  const apiState = useApiResource({
    load: (signal) => fetchMpiPerson(personId, signal),
    onData: setPerson,
    timeoutMs: 10000,
  })

  function splitIdentity(identityGroup: string) {
    void runAction(`split-${identityGroup}`, '拆分失败', async () => {
      await splitMpiPerson(personId, identityGroup, '工作台人工拆分')
      onNotice('已拆分为独立黄金人：该身份与原黄金人的组合永不再自动合并')
      await onSplit()
      const refreshed = await fetchMpiPerson(personId).catch(() => null)
      setPerson(refreshed)
    })
  }

  return (
    <Drawer
      titleId="mpi-person-drawer-title"
      eyebrow="黄金人详情"
      title={person?.goldenName ?? '黄金人'}
      closeLabel="关闭黄金人详情"
      onClose={onClose}
      footer={<Button onClick={onClose}>关闭</Button>}
    >
      {error ? <div className={styles.connectionNotice} role="alert"><CircleAlert size={17} /><div><strong>操作失败</strong><span>{error}</span></div></div> : null}
      {apiState !== 'live' || !person ? <div className={styles.emptyState}>{apiState === 'loading' ? '正在读取黄金人…' : '黄金人详情不可用'}</div> : (
        <>
          <div className={styles.panel}>
            <div className={styles.panelHeader}><div><h3>身份链接</h3><p>当前有效成员 · 决策源与状态</p></div><Split size={18} /></div>
            <table className={styles.compareTable}>
              <thead><tr><th>源身份</th><th>决策源</th><th>操作</th></tr></thead>
              <tbody>
                {person.links.filter((link) => link.linkStatus === 'ACTIVE').map((link) => (
                  <tr key={link.sourceIdentifier}>
                    <td>{link.sourceIdentifier}</td>
                    <td>{link.decisionSource === 'MANUAL' ? '人工' : '规则'}</td>
                    <td><Button onClick={() => splitIdentity(link.sourceIdentifier)} disabled={pendingKey !== null || person.links.filter((item) => item.linkStatus === 'ACTIVE').length <= 1}>拆分</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.panel}>
            <div className={styles.panelHeader}><div><h3>操作历史</h3><p>审计事件 · 最近 20 条</p></div><ShieldCheck size={18} /></div>
            <ul className={styles.checkList}>
              {person.history.map((event, index) => (
                <li key={`${event.action}-${event.createdAt}-${index}`}>{event.action} · {event.actor} · {event.createdAt}</li>
              ))}
              {person.history.length === 0 ? <li>暂无历史事件</li> : null}
            </ul>
          </div>
        </>
      )}
    </Drawer>
  )
}
