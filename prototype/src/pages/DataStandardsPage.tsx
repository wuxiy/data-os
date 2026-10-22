import { ChevronRight, Plus, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { DemoDataBoundary } from '../components/ui/DemoDataBoundary'
import { frontendDemoMode } from '../data/runtimeMode'
import { DataStandardsLive } from './DataStandardsLive'
import { GovernanceTabs } from '../components/ui/GovernanceTabs'
import { PageHeader } from '../components/ui/PageHeader'
import { standards, standardVersions } from '../data/mock'
import type { RouteKey, StandardItem, Tone } from '../types'
import styles from './Pages.module.css'
import local from './DataStandardsPage.module.css'

interface Props {
  onNavigate: (route: RouteKey) => void
  onUnavailable: (label: string) => void
  onNotice: (message: string) => void
}

const categories = ['全部标准', '患者基本信息', '门急诊诊疗', '诊断与治疗', '检验检查', '机构与人员']

// 状态语义映射：自研 tone → antd Tag 语义色。
const TONE_COLOR: Record<Tone, string> = {
  healthy: 'success',
  warning: 'warning',
  danger: 'error',
  neutral: 'default',
}

function statusTone(status: string): Tone {
  if (status === '已发布') return 'healthy'
  if (status === '修订中') return 'warning'
  return 'neutral'
}

export function DataStandardsPage({ onNavigate, onUnavailable, onNotice }: Props) {
  // 真实构建走 G22 标准中心真实链路；演示构建保留静态样例。
  if (!frontendDemoMode) {
    return <DataStandardsLive onNotice={onNotice} onNavigate={onNavigate} onUnavailable={onUnavailable} />
  }
  const [category, setCategory] = useState('全部标准')
  const [selectedId, setSelectedId] = useState(standards[0].id)
  const [query, setQuery] = useState('')
  const visible = useMemo(() => standards.filter((item) => {
    const matchesCategory = category === '全部标准' || item.domain === category
    const keyword = query.trim().toLowerCase()
    return matchesCategory && (!keyword || `${item.code}${item.name}${item.domain}`.toLowerCase().includes(keyword))
  }), [category, query])
  const selected = visible.find((item) => item.id === selectedId) ?? visible[0] ?? null

  const columns: ColumnsType<StandardItem> = [
    {
      title: '标准编码 / 名称',
      key: 'name',
      render: (_, item) => (
        <button className={styles.tableButton} aria-pressed={selected?.id === item.id} onClick={() => setSelectedId(item.id)}>
          <strong>{item.name}</strong>
          <span>{item.code}</span>
        </button>
      ),
    },
    { title: '主题域', key: 'domain', render: (_, item) => item.domain },
    { title: '责任部门', key: 'owner', render: (_, item) => item.owner },
    {
      title: '状态',
      key: 'status',
      render: (_, item) => <Tag color={TONE_COLOR[statusTone(item.status)]}>{item.status}</Tag>,
    },
    { title: '更新时间', key: 'updatedAt', render: (_, item) => item.updatedAt },
  ]

  return (
    <div className={styles.page}>
      <PageHeader
        title="数据标准"
        eyebrow="数据治理 · 标准中心"
        subtitle="院级数据标准的业务定义、值域与版本轨迹，供资产绑定和标准映射引用"
        compact
      />
      <GovernanceTabs route="standards" onNavigate={onNavigate} onUnavailable={onUnavailable} />
      <DemoDataBoundary moduleName="数据标准" onNavigate={onNavigate}>
        <div className={styles.workspace}>
        <aside className={styles.workspaceRail}>
          <div className={styles.sectionTitle}><h2>标准分类</h2><span>{categories.length - 1} 个主题</span></div>
          <div className={styles.search}><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标准名称或编码" aria-label="搜索数据标准" /></div>
          <ul className={styles.tree}>
            {categories.map((item) => <li key={item}><button className={category === item ? styles.selected : ''} aria-pressed={category === item} onClick={() => setCategory(item)}><span>{item}</span><ChevronRight size={14} /></button></li>)}
          </ul>
        </aside>
        <section className={styles.workspaceMain}>
          <div className={styles.listTools}>
            <strong>{category} · {visible.length} 项</strong>
            <div className={styles.listToolsActions}><Button size="small" type="text" disabled={!query && category === '全部标准'} onClick={() => { setQuery(''); setCategory('全部标准') }}>清除筛选</Button><Button size="small" disabled title="演示模式仅供查看，真实模式可导入并创建标准草稿"><Plus size={14} />新建标准</Button></div>
          </div>
          <Table<StandardItem>
            rowKey="id"
            columns={columns}
            dataSource={visible}
            pagination={false}
            rowClassName={(item) => item.id === selected?.id ? styles.activeRow : ''}
            scroll={{ x: 540 }}
            locale={{ emptyText: '未找到匹配的数据标准，请调整搜索条件。' }}
          />
        </section>
        <aside className={styles.workspaceInspector}>
          {selected ? <>
          <div className={styles.sectionTitle}><h3>标准详情</h3><Tag color={TONE_COLOR[statusTone(selected.status)]}>{selected.status}</Tag></div>
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
              {(standardVersions[selected.id] ?? []).map((entry) => (
                <li key={entry.version}><strong>{entry.version} · {entry.label}</strong>{entry.detail}</li>
              ))}
            </ol>
          </div>
          </> : <><div className={styles.sectionTitle}><h3>标准详情</h3></div><p className={local.demoSelection}>当前筛选没有匹配标准。清除关键词或切换主题后继续查看。</p></>}
        </aside>
        </div>
      </DemoDataBoundary>
    </div>
  )
}
