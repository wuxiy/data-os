import { ArrowRight, CheckCircle2, Filter, Link2, Search } from 'lucide-react'
import { useState } from 'react'
import { GovernanceTabs } from '../components/ui/GovernanceTabs'
import { PageHeader } from '../components/ui/PageHeader'
import { Button, StatusTag } from '../components/ui/Primitives'
import type { RouteKey } from '../types'
import styles from './Pages.module.css'

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
  const [selectedField, setSelectedField] = useState('diagnosis_code')
  const [onlyPending, setOnlyPending] = useState(false)
  const current = mappings.find((mapping) => mapping[0] === selectedField) ?? mappings[0]
  const visibleMappings = onlyPending ? mappings.filter((mapping) => mapping[3] !== '已校验') : mappings

  function togglePending() {
    setOnlyPending((value) => {
      const nextValue = !value
      if (nextValue && current[3] === '已校验') {
        const firstPending = mappings.find((mapping) => mapping[3] !== '已校验')
        if (firstPending) setSelectedField(firstPending[0])
      }
      return nextValue
    })
  }
  return (
    <div className={styles.page}>
      <PageHeader title="标准映射" compact onFilterNotice={onNotice} />
      <GovernanceTabs route="mapping" onNavigate={onNavigate} onUnavailable={onUnavailable} />
      <div className={styles.workspace}>
        <aside className={styles.workspaceRail}>
          <div className={styles.sectionTitle}><h2>源数据结构</h2><span>HIS / 门诊诊断</span></div>
          <div className={styles.search}><Search size={15} /><input placeholder="搜索源字段" aria-label="搜索源字段" /></div>
          <ul className={styles.fieldList}>
            {fields.map(([field, description]) => <li key={field}><button className={selectedField === field ? styles.selected : ''} onClick={() => setSelectedField(field)}><strong>{field}</strong><span>{description}</span></button></li>)}
          </ul>
        </aside>
        <section className={styles.workspaceMain}>
          <div className={styles.listTools}><strong>映射矩阵 · 门诊诊断主题</strong><div className={styles.listToolsActions}><Button variant={onlyPending ? 'primary' : 'secondary'} onClick={togglePending}><Filter size={14} />仅看待确认</Button><Button variant="primary" onClick={() => onNotice(`已保存 ${current[0]} 的映射，并创建版本 v1.8`)}><Link2 size={14} />保存此映射</Button></div></div>
          <div className={styles.mappingRows}>
            {visibleMappings.map(([source, name, code, status]) => (
              <button className={`${styles.mappingRow} ${selectedField === source ? styles.mappingRowSelected : ''}`} key={source} onClick={() => setSelectedField(source)}>
                <div><strong>{source}</strong><span>HIS 门诊库</span></div><ArrowRight className={styles.mappingArrow} size={16} />
                <div className={styles.mappingTarget}><strong>{name}</strong><span>{code}</span></div>
                <StatusTag tone={status === '已校验' ? 'healthy' : 'warning'}>{status}</StatusTag>
              </button>
            ))}
          </div>
        </section>
        <aside className={styles.workspaceInspector}>
          <div className={styles.sectionTitle}><h3>映射校验</h3><StatusTag tone={current[3] === '已校验' ? 'healthy' : 'warning'}>{current[3]}</StatusTag></div>
          <div className={styles.inspectorBody}>
            <span className={styles.inspectorCode}>{current[0]} → {current[2]}</span>
            <h2>{current[1]}</h2>
            <div className={styles.validationScore}><strong>{current[3] === '已校验' ? '100' : '86'}</strong><span>校验得分 / 100</span></div>
            <ul className={styles.checkList}>
              <li><CheckCircle2 size={16} />数据类型兼容</li>
              <li><CheckCircle2 size={16} />标准定义相似度 94%</li>
              <li><CheckCircle2 size={16} />值域覆盖 98.7%</li>
              <li><CheckCircle2 size={16} />影响范围已评估</li>
            </ul>
            <dl className={styles.definitionList}>
              <div><dt>转换规则</dt><dd>trim → upper → 标准值域映射</dd></div>
              <div><dt>影响对象</dt><dd>门诊主题 12 张表、4 项指标、2 个数据服务</dd></div>
              <div><dt>映射来源</dt><dd>人工确认 · 复用院级标准映射 v1.7</dd></div>
            </dl>
          </div>
        </aside>
      </div>
    </div>
  )
}
