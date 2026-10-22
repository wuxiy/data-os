import { Surface } from '../components/ui/Surface'
import { Gauge, Save, Settings2 } from 'lucide-react'
import { useState } from 'react'
import { Button, Drawer, Form, Input, Skeleton, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  fetchQualityScore,
  updateQualityScoreStandard,
  QUALITY_RULE_TYPE_LABELS,
  type QualityGradeView,
  type QualityScoreSummary,
} from '../data/controlPlane'
import { formatDateTime } from '../data/domain'
import { useAction } from '../hooks/useAction'
import { useApiResource } from '../hooks/useApiResource'
import styles from './Pages.module.css'
import local from './QualityScorePanel.module.css'

interface Props {
  onNotice: (message: string) => void
}

const DIMENSIONS = ['完整性', '一致性', '规范性', '准确性', '时效性', '稳定性']

/**
 * 质量评分面板（G2G 批次 3，nema 报告评分模型平移）：六维分（规则级得分
 * 均值）→ 加权总分 → 等级；评分标准（通过线/维度权重/等级表）单一生效、
 * 门内可编辑。无终态运行的规则不进入均值（与 nema「无分不计入」同口径）。
 */
export function QualityScorePanel({ onNotice }: Props) {
  const [summary, setSummary] = useState<QualityScoreSummary | null>(null)
  const [standardOpen, setStandardOpen] = useState(false)
  const [passScore, setPassScore] = useState('60')
  const [weights, setWeights] = useState<Record<string, string>>({})
  const [grades, setGrades] = useState<QualityGradeView[]>([])
  const [standardError, setStandardError] = useState<string | null>(null)
  const { pendingKey, error: saveError, setError, run } = useAction(onNotice)
  const saving = pendingKey === 'save-standard'

  const apiState = useApiResource({
    load: (signal) => fetchQualityScore(signal),
    onData: (response) => {
      setSummary(response)
      setPassScore(String(response.standard.passScore))
      setWeights(Object.fromEntries(
        DIMENSIONS.map((dimension) => [dimension, String(response.standard.weights[dimension] ?? 1)])))
      setGrades(response.standard.grades)
    },
    onUnavailable: () => setSummary(null),
  })

  function openStandard() {
    setStandardError(null)
    setError(null)
    setStandardOpen(true)
  }

  function submitStandard() {
    const validScore = (value: string | number) => String(value).trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100
    if (!validScore(passScore)) {
      setStandardError('请填写 0–100 之间的规则通过线。')
      return
    }
    if (DIMENSIONS.some((dimension) => !validScore(weights[dimension] ?? '') || !Number.isInteger(Number(weights[dimension])))) {
      setStandardError('每个维度的权重须为 0–100 之间的整数。')
      return
    }
    if (grades.length === 0 || grades.some((grade) => !grade.grade.trim() || !validScore(grade.lowScore))) {
      setStandardError('请填写等级名称及 0–100 之间的最低分，或移除未使用的等级。')
      return
    }
    if (new Set(grades.map((grade) => grade.grade.trim())).size !== grades.length) {
      setStandardError('等级名称不能重复。')
      return
    }
    setStandardError(null)
    void run('save-standard', '评分标准保存失败，请稍后重试', async () => {
      const nextWeights: Record<string, number> = {}
      for (const dimension of DIMENSIONS) {
        const value = Number(weights[dimension])
        if (!Number.isNaN(value) && value >= 0) nextWeights[dimension] = value
      }
      const nextGrades = grades
        .map((grade) => ({ grade: grade.grade.trim(), lowScore: Number(grade.lowScore) }))
        .filter((grade) => grade.grade && !Number.isNaN(grade.lowScore))
      await updateQualityScoreStandard({
        passScore: Number(passScore),
        weights: nextWeights,
        grades: nextGrades,
      })
      const refreshed = await fetchQualityScore()
      setSummary(refreshed)
      setStandardOpen(false)
      onNotice('评分标准已更新，总分与等级已按新标准重算')
    })
  }

  // 规则得分列定义：数字列右对齐（tabular-nums 由全局表格样式承载）。
  const ruleColumns: ColumnsType<QualityScoreSummary['rules'][number]> = [
    {
      title: '规则',
      key: 'rule',
      render: (_, rule) => {
        const typeLabel = rule.ruleType ? (QUALITY_RULE_TYPE_LABELS[rule.ruleType] ?? rule.ruleType) : null
        // 动态规则展示「类型 · 目标列」（台账投影的真实字段），slug 收进 title 悬停；
        // 静态注册表规则无投影字段，如实回落 ruleId。
        return typeLabel
          ? <span title={rule.ruleId}>{typeLabel}{rule.targetColumn ? ` · ${rule.targetColumn}` : ''}</span>
          : <code className={styles.inlineCode} title={rule.ruleId}>{rule.ruleId}</code>
      },
    },
    { title: '数据集', key: 'datasetId', render: (_, rule) => rule.datasetId },
    {
      title: '得分',
      key: 'score',
      align: 'right',
      className: local.numCell,
      render: (_, rule) => <strong>{rule.score == null ? '—' : rule.score.toFixed(1)}</strong>,
    },
    {
      title: '结果',
      key: 'passed',
      render: (_, rule) => rule.passed == null ? '—' : <Tag color={rule.passed ? 'success' : 'error'}>{rule.passed ? '通过' : '未通过'}</Tag>,
    },
  ]

  return (
    <Surface><section className={styles.panel}>
      <div className={`${styles.panelHeader} ${local.panelHeader}`}>
        <div><h2>质量评分</h2><p>按最近一次有效运行评分；未完成运行的规则不计入总分</p></div>
        <div className={styles.panelHeaderActions}>
          {summary ? <span className={local.updatedAt}>标准更新：{formatDateTime(summary.standard.updatedAt)}</span> : null}
          {apiState === 'live' ? <Button type="text" size="small" onClick={openStandard}><Settings2 size={13} />评分标准</Button> : null}
        </div>
      </div>
      {apiState === 'unavailable' ? (
        <div className={local.scoreState} role="status"><strong>暂时无法读取质量评分</strong><p>请恢复控制面连接后重试，评分标准与历史结果不会以演示数据补位。</p></div>
      ) : summary && summary.rules.every((rule) => rule.score == null) ? (
        /* 首屏空态收一行（2026-10-05 复评 P1-1）：无带评分规则时不再渲染
           巨号占位 + 六根空条的死面板，一行说明 + 保留头部「评分标准」入口。 */
        <div className={local.scoreState}><Gauge size={22} aria-hidden="true" /><strong>等待首轮质量评分</strong><p>完成质量规则复检后，将显示六个维度的得分、加权总分与等级。可先核对「评分标准」中的通过线与权重。</p></div>
      ) : summary ? (
        <>
          <div className={`${styles.scoreHero} ${local.scoreHeroFlat}`}>
            <div className={styles.scoreTotal}>
              <Gauge size={22} />
              <strong>{summary.totalScore == null ? '—' : summary.totalScore.toFixed(1)}</strong>
              {summary.grade ? <Tag>等级 {summary.grade}</Tag> : null}
              {summary.totalScore != null ? <Tag color={summary.totalScore >= summary.standard.passScore ? 'success' : 'warning'}>{summary.totalScore >= summary.standard.passScore ? '达标' : '未达标'}</Tag> : null}
            </div>
            <div className={styles.scoreDimensions}>
              {DIMENSIONS.map((dimension) => {
                const item = summary.dimensions.find((entry) => entry.dimension === dimension)
                return (
                  <div key={dimension} className={styles.scoreDimension}>
                    <span>{dimension}</span>
                    <div className={styles.scoreBar}><i style={{ transform: `scaleX(${Math.max(0, Math.min(100, item?.score ?? 0)) / 100})` }} /></div>
                    <small>{item ? `${item.score.toFixed(1)}（${item.ruleCount} 规则）` : '无运行'}</small>
                  </div>
                )
              })}
            </div>
          </div>
          <Table<QualityScoreSummary['rules'][number]>
            rowKey={(rule) => rule.ruleId}
            columns={ruleColumns}
            dataSource={summary.rules}
            pagination={false}
            scroll={{ x: 480 }}
            locale={{ emptyText: '尚无带评分的规则运行' }}
          />
        </>
      ) : (
        <div className={local.scoreState} role="status" aria-label="正在读取质量评分"><Skeleton active paragraph={{ rows: 3 }} /></div>
      )}

      <Drawer
        open={standardOpen && summary !== null}
        destroyOnHidden
        width="min(540px, 44vw)"
        title={<><span className={local.drawerEyebrow}>评分标准 · 单一生效</span><h2 className={local.drawerTitle}>通过线 / 维度权重 / 等级</h2></>}
        onClose={() => setStandardOpen(false)}
        footer={<><Button onClick={() => setStandardOpen(false)}>取消</Button><Button type="primary" htmlType="submit" form="score-standard-form" loading={saving} icon={<Save size={14} />}>{saving ? '保存中…' : '保存并重算'}</Button></>}
      >
        {summary ? <Form id="score-standard-form" layout="vertical" onFinish={() => submitStandard()}>
          <div className={styles.drawerNotice}><Gauge size={16} /><span>维度分 = 维度内规则得分均值；总分 = 维度加权平均（权重全为 1 时等权）；等级按最低分阈值从高到低判定。</span></div>
          <Form.Item label="规则通过线（0-100）" required>
            <Input type="number" min={0} max={100} value={passScore} onChange={(event) => setPassScore(event.target.value)} />
          </Form.Item>
          <Form.Item label="维度权重（0-100）">
            <div className={styles.drawerFormGrid}>
              {DIMENSIONS.map((dimension) => (
                <Form.Item key={dimension} label={dimension}>
                  <Input type="number" min={0} max={100} value={weights[dimension] ?? '1'}
                    aria-label={`${dimension}权重`}
                    onChange={(event) => setWeights((current) => ({ ...current, [dimension]: event.target.value }))} />
                </Form.Item>
              ))}
            </div>
          </Form.Item>
          <Form.Item label="等级表（按最低分从高到低）">
            {grades.map((grade, index) => (
              <div key={index} className={local.gradeRow}>
                <Input value={grade.grade} aria-label={`等级 ${index + 1} 名称`}
                  onChange={(event) => setGrades((current) => current.map((item, i) => i === index ? { ...item, grade: event.target.value } : item))} />
                <Input type="number" min={0} max={100} value={grade.lowScore} aria-label={`等级 ${index + 1} 最低分`}
                  onChange={(event) => setGrades((current) => current.map((item, i) => i === index ? { ...item, lowScore: Number(event.target.value) } : item))} />
                <Button type="text" size="small" disabled={saving} aria-label={`移除等级 ${index + 1}`} onClick={() => setGrades((current) => current.filter((_, i) => i !== index))}>移除</Button>
              </div>
            ))}
            <Button type="text" size="small" onClick={() => setGrades((current) => [...current, { grade: '', lowScore: 0 }])}>添加等级</Button>
          </Form.Item>
          {standardError || saveError ? <p className={styles.formError} role="alert">{standardError || saveError}</p> : null}
        </Form> : null}
      </Drawer>
    </section></Surface>
  )
}
