import { AlertTriangle, Code2, ExternalLink, FileText, MessageSquareText, Send, ShieldCheck, ThumbsDown, ThumbsUp } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { DemoDataBoundary } from '../components/ui/DemoDataBoundary'
import { PageHeader } from '../components/ui/PageHeader'
import { Button, StatusTag } from '../components/ui/Primitives'
import { assistantScenarios } from '../data/integrations'
import { routePaths } from '../data/mock'
import styles from './IntegrationPages.module.css'

export function AssistantPage({ onNotice, onNavigate, professional = false }: { onNotice: (message: string) => void; onNavigate: (route: 'ingestion' | 'governance' | 'quality') => void; professional?: boolean }) {
  const initialScenario = assistantScenarios.find((scenario) => scenario.id === new URLSearchParams(window.location.search).get('scenario')) ?? assistantScenarios[0]
  const [selectedId, setSelectedId] = useState(initialScenario.id)
  const [draft, setDraft] = useState('')
  const [displayQuestion, setDisplayQuestion] = useState(initialScenario.question)
  const [showSql, setShowSql] = useState(false)
  const selected = assistantScenarios.find((item) => item.id === selectedId) ?? assistantScenarios[0]

  function selectScenario(id: string) {
    const next = assistantScenarios.find((item) => item.id === id) ?? assistantScenarios[0]
    setSelectedId(id)
    setDisplayQuestion(next.question)
    setShowSql(false)
  }

  function submitQuestion(event: FormEvent) {
    event.preventDefault()
    const question = draft.trim()
    if (!question) return
    setDisplayQuestion(question)
    setDraft('')
    onNotice('当前为交互原型，已使用脱敏演示数据生成回答结构')
  }

  return (
    <div className={styles.integrationPage}>
      <PageHeader
        title={professional ? '专业问数工作区' : '智能问数'}
        eyebrow={professional ? '受控只读分析 · 专业模式' : '受控只读分析'}
        subtitle={professional ? '面向数据分析人员的可复核工作区，保留查询口径、SQL 和数据资产证据。' : '自然语言提出业务问题，回答必须同时给出数据来源、查询口径和可复核证据'}
        compact
      />
      <DemoDataBoundary moduleName={professional ? '专业问数工作区' : '智能问数'} onNavigate={onNavigate}>
        <div className={styles.assistantWorkspace}>
        <aside className={styles.conversationRail} aria-label="问数会话">
          <div className={styles.railHeader}><h2>最近会话</h2><span className={styles.railCount}>{assistantScenarios.length}</span></div>
          <ul className={styles.conversationList}>
            {assistantScenarios.map((scenario) => (
              <li key={scenario.id}>
                <button
                  className={`${styles.conversationItem} ${scenario.id === selected.id ? styles.conversationItemSelected : ''}`}
                  onClick={() => selectScenario(scenario.id)}
                  aria-pressed={scenario.id === selected.id}
                >
                  <strong>{scenario.title}</strong><span>{scenario.time} · 已核对来源</span>
                </button>
              </li>
            ))}
          </ul>
          <section className={styles.promptGroup}>
            <h3>建议提问</h3>
            <ul className={styles.promptList}>
              {assistantScenarios.map((scenario) => <li key={scenario.id}><button className={styles.promptButton} onClick={() => selectScenario(scenario.id)}>{scenario.question}</button></li>)}
            </ul>
          </section>
        </aside>

        <section className={styles.chatMain} aria-label="智能问数对话">
          <header className={styles.chatHeader}>
            <div className={styles.chatIdentity}>
              <span className={styles.chatIdentityIcon}><MessageSquareText size={17} /></span>
              <div><strong>医疗运营问数助手</strong><span>仅查询已授权的可信数据集</span></div>
            </div>
            <StatusTag tone="healthy">只读模式</StatusTag>
          </header>
          <div className={styles.chatScroll} aria-live="polite">
            <div className={styles.userBubbleRow}><div className={styles.userBubble}>{displayQuestion}</div></div>
            <article className={styles.assistantAnswer}>
              <header className={styles.answerHeader}>
                <div className={styles.answerIdentity}>
                  <span className={styles.chatIdentityIcon}><MessageSquareText size={16} /></span>
                  <div><strong>分析结果</strong><span>演示响应 · 基于 3 项可信数据资产</span></div>
                </div>
                <div className={styles.answerActions}>
                  <button className={styles.iconButton} onClick={() => onNotice('已记录回答有帮助')} aria-label="回答有帮助"><ThumbsUp size={15} /></button>
                  <button className={styles.iconButton} onClick={() => onNotice('已记录问题并进入问数优化清单')} aria-label="回答需要改进"><ThumbsDown size={15} /></button>
                  <button className={styles.iconButton} onClick={() => setShowSql((value) => !value)} aria-label={showSql ? '隐藏生成的查询' : '查看生成的查询'} aria-pressed={showSql}><Code2 size={16} /></button>
                </div>
              </header>
              <div className={styles.answerCopy}>
                <p>{selected.answer}</p>
                <div className={styles.finding}><AlertTriangle size={15} /><span><strong>需要关注：</strong>{selected.finding}</span></div>
              </div>
              <div className={styles.answerGrid}>
                <section className={styles.answerPanel}>
                  <h3>主要贡献对象</h3>
                  <ol className={styles.barList}>
                    {selected.chart.map((item) => (
                      <li className={styles.barRow} key={item.label}>
                        <div className={styles.barRowTop}><span>{item.label}</span><span>{item.display}</span></div>
                        <div className={styles.barTrack}><div className={styles.barFill} style={{ width: `${item.value}%` }} /></div>
                      </li>
                    ))}
                  </ol>
                </section>
                <section className={styles.answerPanel}>
                  <h3>核对明细</h3>
                  <div className={styles.horizontalScroll}>
                    <table className={styles.resultTable}>
                      <thead><tr><th>对象</th><th>业务量</th><th>关键指标</th><th>变化</th></tr></thead>
                      <tbody>{selected.table.map((row) => <tr key={row.department}><td>{row.department}</td><td>{row.visits}</td><td>{row.wait}</td><td>{row.change}</td></tr>)}</tbody>
                    </table>
                  </div>
                </section>
              </div>
              <div className={`${styles.sqlPanel} ${showSql ? styles.sqlPanelVisible : ''}`} aria-hidden={!showSql}>
                <div className={styles.sqlInner}><pre>{selected.sql}</pre></div>
              </div>
            </article>
          </div>
          <form className={styles.composer} onSubmit={submitQuestion}>
            <div className={styles.composerBox}>
              <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="继续追问，例如：排除停诊因素后，各科室变化如何？" aria-label="输入问数问题" rows={1} />
              <button className={styles.sendButton} type="submit" disabled={!draft.trim()} aria-label="发送问题"><Send size={17} /></button>
            </div>
            <p className={styles.composerNote}>回答用于辅助分析；重要结论请结合口径、来源与业务背景复核。</p>
          </form>
        </section>

        <aside className={styles.evidenceRail} aria-label="问数证据">
          <div className={styles.evidenceHeader}><h2>回答证据</h2><StatusTag tone="healthy">可复核</StatusTag></div>
          <div className={styles.evidenceBody}>
            <div className={styles.evidenceStamp}>
              <span className={styles.evidenceStampIcon}><FileText size={17} /></span>
              <div><strong>查询记录已留存</strong><span>{selected.queryId}</span></div>
            </div>
            <dl className={styles.evidenceDefinition}>
              <div><dt>统计范围</dt><dd>市第一人民医院 · 当前用户授权院区</dd></div>
              <div><dt>执行边界</dt><dd>仅访问 DWS/ADS 脱敏只读视图，最多返回 2,000 行。</dd></div>
              <div><dt>生成时间</dt><dd>08-03 09:48 · 用时 8.7 秒</dd></div>
            </dl>
            <section className={styles.evidenceSection}>
              <h3>本次使用的数据</h3>
              <ul className={styles.sourceList}>{selected.sources.map((source) => <li key={source.name}><strong>{source.name}</strong><span>{source.detail}</span></li>)}</ul>
            </section>
            <div className={styles.safeBoundary}><ShieldCheck size={15} /><span>查询由受控服务执行；助手不能修改标准、质量规则、主数据或源系统。</span></div>
            <Button className={styles.evidenceAction} onClick={() => setShowSql(true)}><Code2 size={14} />查看查询与口径</Button>
            <a
              className={`${styles.externalLinkButton} ${styles.externalLinkButtonQuiet} ${styles.evidenceAction}`}
              href={`${routePaths.assistantWorkspace}?scenario=${encodeURIComponent(selected.id)}`}
              target="_blank"
              rel="noreferrer"
            >进入专业工作区 <ExternalLink size={13} /></a>
          </div>
        </aside>
        </div>
      </DemoDataBoundary>
    </div>
  )
}
