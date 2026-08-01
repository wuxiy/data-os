import { CheckCircle2, GitMerge, RotateCcw, Search, ShieldCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PageHeader } from '../components/ui/PageHeader'
import { Button, StatusTag } from '../components/ui/Primitives'
import { mpiCandidates } from '../data/mock'
import styles from './Pages.module.css'

const comparison = [
  ['患者姓名', '张伟', '张伟', '张伟'],
  ['身份证号', '3201********4812', '3201********4812', '3201********4812'],
  ['出生日期', '1982-04-18', '1982-04-18', '1982-04-18'],
  ['手机号', '138****0912', '139****0912', '138****0912'],
  ['现住址', '南京市鼓楼区…', '南京市鼓楼区…', '南京市鼓楼区…'],
  ['院内患者号', 'H000183729', 'E00962817', '保留为多标识'],
]

export function MpiReviewPage({ onNotice }: { onNotice: (message: string) => void }) {
  const [selectedId, setSelectedId] = useState(mpiCandidates[0].id)
  const [confirmed, setConfirmed] = useState(false)
  const [merged, setMerged] = useState(false)
  const [query, setQuery] = useState('')
  const selected = mpiCandidates.find((item) => item.id === selectedId) ?? mpiCandidates[0]
  const visibleCandidates = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return keyword ? mpiCandidates.filter((item) => `${item.id}${item.leftName}${item.rightName}${item.system}`.toLowerCase().includes(keyword)) : mpiCandidates
  }, [query])

  function confirmRelation() {
    setMerged(true)
    onNotice('已建立患者身份关联；原始记录保留，可在审计记录中撤销')
  }

  return (
    <div className={styles.page}>
      <PageHeader title="主索引候选审核" eyebrow="主索引与主数据" compact />
      <div className={styles.mpiWorkspace}>
        <aside className={styles.workspaceRail}>
          <div className={styles.sectionTitle}><h2>候选队列</h2><span>36 待审核</span></div>
          <div className={styles.search}><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="患者姓名或候选号" aria-label="搜索主索引候选" /></div>
          <ul className={styles.queue}>
            {visibleCandidates.map((candidate) => <li key={candidate.id}><button className={selected.id === candidate.id ? styles.selected : ''} onClick={() => { setSelectedId(candidate.id); setMerged(false); setConfirmed(false) }}><span className={styles.queueTop}><span className={styles.queueId}>{candidate.id}</span><StatusTag tone={candidate.score >= 95 ? 'healthy' : 'warning'}>{candidate.score}% 匹配</StatusTag></span><span className={styles.queueTitle}>{candidate.leftName} ↔ {candidate.rightName}</span><span className={styles.queueMeta}>{candidate.system} · {candidate.risk}</span></button></li>)}
            {visibleCandidates.length === 0 ? <li className={styles.emptyState}>未找到匹配的候选记录</li> : null}
          </ul>
        </aside>
        <section className={styles.mpiMain}>
          <div className={styles.mpiTop}>
            <div><StatusTag tone={merged ? 'healthy' : 'warning'}>{merged ? '已建立关联' : '需人工确认'}</StatusTag><h2>{selected.leftName} 与 {selected.rightName}</h2><p>{selected.id} · {selected.system} · 匹配模型 v2.4</p></div>
            <div className={styles.score}><strong>{selected.score}%</strong><span>综合匹配置信度</span></div>
          </div>
          <div className={styles.compareWrap}>
            <table className={styles.compareTable}>
              <thead><tr><th>身份属性</th><th>HIS 患者记录</th><th>EMR 患者记录</th><th>黄金记录建议</th></tr></thead>
              <tbody>
                {comparison.map(([field, left, right, golden]) => <tr key={field}><td>{field}</td><td>{left}</td><td>{right}</td><td className={styles.recommendedValue}><select defaultValue={golden} aria-label={`${field}黄金记录取值`}><option>{golden}</option><option>{left}</option><option>{right}</option></select></td></tr>)}
              </tbody>
            </table>
          </div>
          <div className={styles.mpiLower}>
            <section className={styles.panel}>
              <div className={styles.panelHeader}><div><h3>匹配证据</h3><p>逐项证据可解释、可复核</p></div><ShieldCheck size={18} color="var(--jade)" /></div>
              <ul className={`${styles.checkList} ${styles.compactCheckList}`}><li><CheckCircle2 size={16} />身份证号完全一致 · 权重 60%</li><li><CheckCircle2 size={16} />姓名与出生日期一致 · 权重 30%</li><li><CheckCircle2 size={16} />地址相似度 92% · 权重 8%</li><li><StatusTag tone="warning">需确认</StatusTag>手机号冲突 · 扣减 2%</li></ul>
            </section>
            <section className={styles.panel}>
              <div className={styles.panelHeader}><div><h3>合并影响</h3><p>建立关联，不覆盖源系统原始数据</p></div><GitMerge size={18} color="var(--jade)" /></div>
              <dl className={`${styles.definitionList} ${styles.paddedDefinitionList}`}><div><dt>关联记录</dt><dd>2 条患者记录、5 个院内就诊标识</dd></div><div><dt>下游影响</dt><dd>患者 360 视图、3 个数据服务、2 项随访任务</dd></div><div><dt>回滚能力</dt><dd>保留原始记录与字段级来源，可撤销本次关联</dd></div></dl>
            </section>
          </div>
          <div className={styles.mpiActions}>
            <label className={styles.confirmCheck}><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={merged} /><span>我已核对关键身份属性与影响范围，确认两条记录属于同一患者。该操作只建立身份关联，不回写覆盖源系统。</span></label>
            <div className={styles.actionGroup}><Button onClick={() => onNotice('候选已退回规则调整队列')} disabled={merged}><RotateCcw size={14} />退回</Button><Button variant="primary" disabled={!confirmed || merged} onClick={confirmRelation}><GitMerge size={14} />{merged ? '已建立关联' : '确认建立关联'}</Button></div>
          </div>
        </section>
      </div>
    </div>
  )
}
