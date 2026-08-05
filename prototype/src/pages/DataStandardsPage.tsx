import { ChevronRight, Filter, Plus, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { DemoDataBoundary } from '../components/ui/DemoDataBoundary'
import { GovernanceTabs } from '../components/ui/GovernanceTabs'
import { PageHeader } from '../components/ui/PageHeader'
import { Button, StatusTag } from '../components/ui/Primitives'
import { standards } from '../data/mock'
import type { RouteKey, StandardItem } from '../types'
import styles from './Pages.module.css'

interface Props {
  onNavigate: (route: RouteKey) => void
  onUnavailable: (label: string) => void
  onNotice: (message: string) => void
}

const categories = ['全部标准', '患者基本信息', '门急诊诊疗', '诊断与治疗', '检验检查', '机构与人员']

export function DataStandardsPage({ onNavigate, onUnavailable, onNotice }: Props) {
  const [category, setCategory] = useState('全部标准')
  const [selectedId, setSelectedId] = useState(standards[0].id)
  const [query, setQuery] = useState('')
  const selected = standards.find((item) => item.id === selectedId) ?? standards[0]
  const visible = useMemo(() => standards.filter((item) => {
    const matchesCategory = category === '全部标准' || item.domain === category
    const keyword = query.trim().toLowerCase()
    return matchesCategory && (!keyword || `${item.code}${item.name}${item.domain}`.toLowerCase().includes(keyword))
  }), [category, query])

  return (
    <div className={styles.page}>
      <PageHeader title="数据标准" compact onFilterNotice={onNotice} />
      <GovernanceTabs route="standards" onNavigate={onNavigate} onUnavailable={onUnavailable} />
      <DemoDataBoundary moduleName="数据标准" onNavigate={onNavigate}>
        <div className={styles.workspace}>
        <aside className={styles.workspaceRail}>
          <div className={styles.sectionTitle}><h2>标准分类</h2><span>5 个主题</span></div>
          <div className={styles.search}><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标准名称或编码" aria-label="搜索数据标准" /></div>
          <ul className={styles.tree}>
            {categories.map((item) => <li key={item}><button className={category === item ? styles.selected : ''} onClick={() => setCategory(item)}><span>{item}</span><ChevronRight size={14} /></button></li>)}
          </ul>
        </aside>
        <section className={styles.workspaceMain}>
          <div className={styles.listTools}>
            <strong>{category} · {visible.length} 项</strong>
            <div className={styles.listToolsActions}><Button onClick={() => onNotice('已应用当前分类与关键词筛选条件')}><Filter size={14} />筛选</Button><Button variant="primary" onClick={() => onNotice('新建标准流程已进入草稿箱')}><Plus size={14} />新建标准</Button></div>
          </div>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead><tr><th>标准编码 / 名称</th><th>主题域</th><th>责任部门</th><th>状态</th><th>更新时间</th></tr></thead>
              <tbody>
                {visible.map((item) => <StandardRow key={item.id} item={item} active={selected.id === item.id} onSelect={() => setSelectedId(item.id)} />)}
                {visible.length === 0 ? <tr><td colSpan={5}>未找到匹配的数据标准，请调整搜索条件。</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
        <aside className={styles.workspaceInspector}>
          <div className={styles.sectionTitle}><h3>标准详情</h3><StatusTag tone={selected.status === '已发布' ? 'healthy' : 'warning'}>{selected.status}</StatusTag></div>
          <div className={styles.inspectorBody}>
            <span className={styles.inspectorCode}>{selected.code}</span>
            <h2>{selected.name}</h2>
            <dl className={styles.definitionList}>
              <div><dt>业务定义</dt><dd>{selected.definition}</dd></div>
              <div><dt>标准来源</dt><dd>{selected.source}</dd></div>
              <div><dt>允许值域</dt><dd>{selected.valueRange}</dd></div>
              <div><dt>责任部门</dt><dd>{selected.owner}</dd></div>
            </dl>
            <ol className={styles.versionTrail}>
              <li><strong>v2.1 · 当前版本</strong>2026-07-29 由标准委员会发布</li>
              <li><strong>v2.0 · 修订定义</strong>2026-05-18 补充区域平台映射要求</li>
              <li><strong>v1.0 · 初始发布</strong>2026-02-06</li>
            </ol>
          </div>
        </aside>
        </div>
      </DemoDataBoundary>
    </div>
  )
}

function StandardRow({ item, active, onSelect }: { item: StandardItem; active: boolean; onSelect: () => void }) {
  return (
    <tr className={active ? styles.activeRow : ''}>
      <td className={styles.noCellPadding}><button className={styles.tableButton} onClick={onSelect}><strong>{item.name}</strong><span>{item.code}</span></button></td>
      <td>{item.domain}</td><td>{item.owner}</td><td><StatusTag tone={item.status === '已发布' ? 'healthy' : item.status === '修订中' ? 'warning' : 'neutral'}>{item.status}</StatusTag></td><td>{item.updatedAt}</td>
    </tr>
  )
}
