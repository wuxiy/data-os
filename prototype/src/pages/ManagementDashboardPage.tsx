import { AlertTriangle, ChevronRight } from 'lucide-react'
import { TrendChart } from '../components/charts/TrendChart'
import { PageHeader } from '../components/ui/PageHeader'
import { Button, MetricStrip, StatusTag } from '../components/ui/Primitives'
import { managementMetrics } from '../data/mock'
import styles from './Pages.module.css'

export function ManagementDashboardPage({ onOpenChain, onUnavailable }: { onOpenChain: () => void; onUnavailable: (label: string) => void }) {
  return (
    <div className={styles.page}>
      <PageHeader title="医院数据运营总览" eyebrow="管理驾驶舱" subtitle="以结果、风险和交付进展为中心" />
      <MetricStrip metrics={managementMetrics} onSelect={onOpenChain} />
      <div className={styles.content}>
        <section className={styles.attention}>
          <div className={styles.attentionText}>
            <AlertTriangle size={21} />
            <div><h2>今日有 3 项需要关注</h2><p>核心数据可用率低于目标，4 项治理问题已逾期，36 条主索引候选待人工审核。</p></div>
          </div>
          <Button variant="secondary" onClick={onOpenChain}>查看治理责任链 <ChevronRight size={15} /></Button>
        </section>
        <div className={styles.twoColumns}>
          <TrendChart title="近 30 天核心数据健康趋势" primaryLabel="可用率" secondaryLabel="标准覆盖率" />
          <RiskRanking onSelect={onOpenChain} />
        </div>
        <section className={styles.flowPanel}>
          <div className={styles.flowHeader}><h2>从接入到使用</h2><span>今日全链路状态 · 08-01 14:30</span></div>
          <div className={styles.flow}>
            {[
              ['接入', '18 个系统 · 17 正常'], ['标准化', '1,286 项映射 · 38 待确认'], ['质量治理', '98.6% 通过 · 23 待闭环'], ['主索引', '99.2% 准确 · 36 待审核'], ['数据服务', '46 项服务 · 12.8 万次调用'],
            ].map(([name, value]) => <div className={styles.flowStep} key={name}><strong>{name}</strong><span>{value}</span></div>)}
          </div>
        </section>
        <section className={styles.tablePanel}>
          <div className={styles.panelHeader}><div><h2>重点交付进展</h2><p>面向院内经营、临床与上报场景</p></div><button className={styles.textButton} onClick={() => onUnavailable('交付中心')}>查看全部 <ChevronRight size={13} /></button></div>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead><tr><th>交付主题</th><th>使用部门</th><th>当前阶段</th><th>数据可用率</th><th>计划上线</th><th>状态</th></tr></thead>
              <tbody>
                <tr><td>门诊运营主题库</td><td>门诊部</td><td>试运行</td><td>99.1%</td><td>08-08</td><td><StatusTag tone="healthy">按计划</StatusTag></td></tr>
                <tr><td>病案首页质量专题</td><td>病案室</td><td>质量整改</td><td>96.8%</td><td>08-12</td><td><StatusTag tone="warning">需关注</StatusTag></td></tr>
                <tr><td>区域检验共享数据集</td><td>信息中心</td><td>标准映射</td><td>94.5%</td><td>08-20</td><td><StatusTag tone="warning">待确认</StatusTag></td></tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}

function RiskRanking({ onSelect }: { onSelect: () => void }) {
  const risks = [
    ['LIS', '检验科数据管理员', '18'], ['EMR', '病案室数据管理员', '12'], ['手麻系统', '麻醉科数据管理员', '7'], ['病案首页', '病案室数据管理员', '5'],
  ]
  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}><div><h2>高风险系统排行</h2><p>按逾期问题数排序</p></div><button className={styles.textButton} onClick={onSelect}>查看责任 <ChevronRight size={13} /></button></div>
      <ol className={styles.ranking}>
        {risks.map(([system, owner, value], index) => <li key={system}><span className={styles.rank}>{index + 1}</span><div className={styles.rankBody}><strong>{system}</strong><span>{owner}</span></div><span className={styles.rankValue}>{value}</span></li>)}
      </ol>
    </section>
  )
}
