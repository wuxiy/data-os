import { AlertTriangle, ChevronRight } from 'lucide-react'
import { Button, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { DemoDataBoundary } from '../components/ui/DemoDataBoundary'
import { TrendChart } from '../components/charts/TrendChart'
import { PageHeader } from '../components/ui/PageHeader'
import { MetricStrip } from '../components/ui/Primitives'
import { managementMetrics, riskRanking } from '../data/mock'
import { demoFlowSnapshotLabel, demoSnapshotAsOf } from '../data/runtimeMode'
import { frontendDemoMode } from '../data/runtimeMode'
import { ManagementDashboardLive } from './ManagementDashboardLive'
import type { Tone } from '../types'
import styles from './Pages.module.css'
import local from './ManagementDashboardPage.module.css'

// 状态语义映射：自研 tone → antd Tag 语义色。
const TONE_COLOR: Record<Tone, string> = {
  healthy: 'success',
  warning: 'warning',
  danger: 'error',
  neutral: 'default',
}

interface DeliveryRow {
  key: string
  theme: string
  department: string
  stage: string
  availability: string
  launchDate: string
  status: { label: string; tone: Tone }
}

const DELIVERY_ROWS: DeliveryRow[] = [
  { key: 'op-theme', theme: '门诊运营主题库', department: '门诊部', stage: '试运行', availability: '99.1%', launchDate: '08-08', status: { label: '按计划', tone: 'healthy' } },
  { key: 'mr-quality', theme: '病案首页质量专题', department: '病案室', stage: '质量整改', availability: '96.8%', launchDate: '08-12', status: { label: '需关注', tone: 'warning' } },
  { key: 'lab-sharing', theme: '区域检验共享数据集', department: '信息中心', stage: '标准映射', availability: '94.5%', launchDate: '08-20', status: { label: '待确认', tone: 'warning' } },
]

const deliveryColumns: ColumnsType<DeliveryRow> = [
  { title: '交付主题', dataIndex: 'theme', key: 'theme' },
  { title: '使用部门', dataIndex: 'department', key: 'department' },
  { title: '当前阶段', dataIndex: 'stage', key: 'stage' },
  { title: '数据可用率', dataIndex: 'availability', key: 'availability', align: 'right', className: local.numCell },
  { title: '计划上线', dataIndex: 'launchDate', key: 'launchDate', align: 'right', className: local.numCell },
  {
    title: '状态',
    key: 'status',
    render: (_, row) => <Tag color={TONE_COLOR[row.status.tone]}>{row.status.label}</Tag>,
  },
]

export function ManagementDashboardPage({ onOpenChain, onNotice, onNavigate }: { onOpenChain: () => void; onNotice: (message: string) => void; onNavigate: (route: 'ingestion' | 'governance' | 'quality' | 'mpi' | 'aiData' | 'dataServices' | 'operationsCenter') => void }) {
  // 真实构建走 G24 运营投影；演示构建保留静态样例。
  if (!frontendDemoMode) {
    return <ManagementDashboardLive onNotice={onNotice} onNavigate={onNavigate} />
  }
  return (
    <div className={styles.page}>
      <PageHeader title="医院数据运营总览" eyebrow="管理驾驶舱" subtitle="以结果、风险和交付进展为中心" asOf={demoSnapshotAsOf} />
      <div className={styles.content}>
        <DemoDataBoundary moduleName="医院数据运营总览" onNavigate={onNavigate}>
        <MetricStrip metrics={managementMetrics} onSelect={onOpenChain} />
        {/* 只留需要动作的结论与入口（2026-10-06 对齐收敛）：异常计数在指标带已有，
            此处不复述数字。 */}
        <section className={styles.attention}>
          <div className={styles.attentionText}>
            <AlertTriangle size={21} />
            <div><h2>今日 3 类事项需要关注</h2><p>核心数据可用率未达标、治理问题逾期、主索引候选积压，均需今日认领处理——沿责任链定位责任部门。</p></div>
          </div>
          <Button onClick={onOpenChain}>查看治理责任链 <ChevronRight size={15} /></Button>
        </section>
        <div className={styles.twoColumns}>
          <TrendChart title="近 30 天核心数据健康趋势" primaryLabel="可用率" secondaryLabel="标准覆盖率" />
          <RiskRanking onSelect={onOpenChain} />
        </div>
        <section className={styles.flowPanel}>
          <div className={styles.flowHeader}><h2>从接入到使用</h2><span>{demoFlowSnapshotLabel}</span></div>
          <div className={styles.flow}>
            {[
              /* 只留阶段吞吐（2026-10-06 对齐收敛）：待确认/待闭环/待审核等异常计数
                 由指标带与关注带表达，此处不复述。 */
              ['接入', '18 个系统 · 17 正常'], ['标准化', '1,286 项映射'], ['质量治理', '98.6% 规则通过'], ['主索引', '99.2% 准确'], ['数据服务', '46 项服务 · 12.8 万次调用'],
            ].map(([name, value]) => <div className={styles.flowStep} key={name}><strong>{name}</strong><span>{value}</span></div>)}
          </div>
        </section>
        <section className={styles.tablePanel}>
          <div className={styles.panelHeader}><div><h2>重点交付进展</h2><p>面向院内经营、临床与上报场景 · 完整清单在交付中心</p></div></div>
          <Table<DeliveryRow>
            rowKey="key"
            columns={deliveryColumns}
            dataSource={DELIVERY_ROWS}
            pagination={false}
          />
        </section>
        </DemoDataBoundary>
      </div>
    </div>
  )
}

function RiskRanking({ onSelect }: { onSelect: () => void }) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}><div><h2>高风险系统排行</h2><p>按逾期与高危问题综合排序</p></div><Button type="text" size="small" onClick={onSelect}>查看全部 <ChevronRight size={13} /></Button></div>
      <ol className={styles.ranking}>
        {riskRanking.map(({ system, owner, value }, index) => <li key={system}><span className={styles.rank}>{String(index + 1).padStart(2, '0')}</span><div className={styles.rankBody}><strong>{system}</strong><span>{owner}</span></div><span className={styles.rankValue}>{value}</span></li>)}
      </ol>
    </section>
  )
}
