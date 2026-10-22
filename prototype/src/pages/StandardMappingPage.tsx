import { Surface } from '../components/ui/Surface'
import { ArrowRight, CheckCircle2, CircleHelp, Filter, Link2, Search } from 'lucide-react'
import { useState } from 'react'
import { Button, Tag } from 'antd'
import { DemoDataBoundary } from '../components/ui/DemoDataBoundary'
import { frontendDemoMode } from '../data/runtimeMode'
import { StandardMappingLive } from './StandardMappingLive'
import { GovernanceTabs } from '../components/ui/GovernanceTabs'
import { PageHeader } from '../components/ui/PageHeader'
import type { RouteKey } from '../types'
import styles from './Pages.module.css'
import local from './StandardMappingPage.module.css'

const fields = [
  ['patient_name', '患者姓名 · varchar(50)'], ['sex_code', '性别代码 · varchar(1)'], ['birth_date', '出生日期 · date'], ['diagnosis_code', '疾病诊断编码 · varchar(20)'], ['visit_time', '就诊日期时间 · datetime'], ['dept_code', '科室代码 · varchar(16)'],
]

const mappings = [
  ['patient_name', '患者姓名', 'DE01.00.009.00', '已校验'], ['sex_code', '生理性别代码', 'DE02.01.040.00', '已校验'], ['birth_date', '出生日期', 'DE02.01.005.01', '已校验'], ['diagnosis_code', '疾病诊断编码', 'DE06.00.193.00', '待确认'], ['visit_time', '门诊就诊日期时间', 'DE02.01.040.00', '已校验'], ['dept_code', '医疗机构科室代码', 'MDM.ORG.DEPT', '规则建议'],
]

interface Props {
  onNavigate: (route: RouteKey) => void
  onUnavailable: (label: string) => void
  onNotice: (message: string) => void
}

export function StandardMappingPage({ onNavigate, onUnavailable, onNotice }: Props) {
  // 真实构建走 G23 标准映射真实链路；演示构建保留静态样例。
  if (!frontendDemoMode) {
    return <StandardMappingLive onNotice={onNotice} onNavigate={onNavigate} onUnavailable={onUnavailable} />
  }
  const [selectedField, setSelectedField] = useState('diagnosis_code')
  const [onlyPending, setOnlyPending] = useState(false)
  const [query, setQuery] = useState('')
  const keyword = query.trim().toLowerCase()
  const visibleFields = fields.filter((field) => !keyword || field.join(' ').toLowerCase().includes(keyword))
  const visibleMappings = mappings.filter((mapping) => (!onlyPending || mapping[3] !== '已校验') && (!keyword || `${mapping.join(' ')} ${fields.find((field) => field[0] === mapping[0])?.[1] ?? ''}`.toLowerCase().includes(keyword)))
  const current = visibleMappings.find((mapping) => mapping[0] === selectedField) ?? visibleMappings[0] ?? null

  function togglePending() {
    setOnlyPending((value) => {
      const nextValue = !value
      if (nextValue && current?.[3] === '已校验') {
        const firstPending = mappings.find((mapping) => mapping[3] !== '已校验')
        if (firstPending) setSelectedField(firstPending[0])
      }
      return nextValue
    })
  }
  return (
    <div className={styles.page}>
      <PageHeader title="标准映射" subtitle="核对源字段与标准定义，确认转换规则及影响范围" compact />
      <GovernanceTabs route="mapping" onNavigate={onNavigate} onUnavailable={onUnavailable} />
      <DemoDataBoundary moduleName="标准映射" onNavigate={onNavigate}>
        <div className={styles.workspace}>
        <Surface><aside className={styles.workspaceRail}>
          <div className={styles.sectionTitle}><h2>源数据结构</h2><span>HIS / 门诊诊断</span></div>
          <div className={styles.search}><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索源字段" aria-label="搜索源字段" /></div>
          <ul className={styles.fieldList}>
            {visibleFields.map(([field, description]) => <li key={field}><button className={current?.[0] === field ? styles.selected : ''} aria-pressed={current?.[0] === field} onClick={() => setSelectedField(field)}><strong>{field}</strong><span>{description}</span></button></li>)}
            {visibleFields.length === 0 ? <li className={local.quietState}>没有匹配的源字段</li> : null}
          </ul>
        </aside></Surface>
        <section className={styles.workspaceMain}>
          <div className={styles.listTools}><strong>映射矩阵 · {visibleMappings.length} 项</strong><div className={styles.listToolsActions}><Button size="small" aria-pressed={onlyPending} className={onlyPending ? local.filterActive : ''} onClick={togglePending}><Filter size={14} />仅看待确认</Button><Button size="small" disabled title="演示模式仅供查看，真实模式可维护映射草稿"><Link2 size={14} />保存此映射</Button></div></div>
          <div className={styles.mappingRows}>
            {visibleMappings.map(([source, name, code, status]) => (
              <button className={`${styles.mappingRow} ${local.rowPad} ${current?.[0] === source ? styles.mappingRowSelected : ''}`} aria-pressed={current?.[0] === source} key={source} onClick={() => setSelectedField(source)}>
                <div><strong>{source}</strong><span>HIS 门诊库</span></div><ArrowRight className={styles.mappingArrow} size={16} />
                <div className={styles.mappingTarget}><strong>{name}</strong><span>{code}</span></div>
                <Tag color={status === '已校验' ? 'success' : 'warning'}>{status}</Tag>
              </button>
            ))}
            {visibleMappings.length === 0 ? <div className={local.quietState}>没有匹配的映射。<Button type="link" size="small" onClick={() => { setQuery(''); setOnlyPending(false) }}>清除筛选</Button></div> : null}
          </div>
        </section>
        <Surface><aside className={styles.workspaceInspector}>
          {current ? <>
          <div className={styles.sectionTitle}><h3>映射校验</h3><Tag color={current[3] === '已校验' ? 'success' : 'warning'}>{current[3]}</Tag></div>
          <div className={styles.inspectorBody}>
            <span className={styles.inspectorCode}>{current[0]} → {current[2]}</span>
            <h2>{current[1]}</h2>
            <div className={`${styles.validationScore} ${current[3] === '已校验' ? '' : local.scorePending}`}><strong>{current[3] === '已校验' ? '100' : '86'}</strong><span>校验得分 / 100</span></div>
            <ul className={styles.checkList}>
              <li><CheckCircle2 size={16} />数据类型兼容</li>
              {current[3] === '已校验' ? <><li><CheckCircle2 size={16} />标准定义已核对</li><li><CheckCircle2 size={16} />值域覆盖已确认</li><li><CheckCircle2 size={16} />影响范围已评估</li></> : <><li className={local.pendingCheck}><CircleHelp size={16} />标准定义待人工确认</li><li className={local.pendingCheck}><CircleHelp size={16} />值域覆盖待复核</li><li className={local.pendingCheck}><CircleHelp size={16} />影响范围待确认</li></>}
            </ul>
            <dl className={styles.definitionList}>
              <div><dt>转换规则</dt><dd>trim → upper → 标准值域映射</dd></div>
              <div><dt>影响对象</dt><dd>门诊主题 12 张表、4 项指标、2 个数据服务</dd></div>
              <div><dt>映射来源</dt><dd>人工确认 · 复用院级标准映射 v1.7</dd></div>
            </dl>
          </div>
          </> : <><div className={styles.sectionTitle}><h3>映射校验</h3></div><p className={local.quietState}>选择一个匹配字段后查看标准与校验依据。</p></>}
        </aside></Surface>
        </div>
      </DemoDataBoundary>
    </div>
  )
}
