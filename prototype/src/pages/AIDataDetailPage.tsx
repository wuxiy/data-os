import { CircleAlert } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Drawer, Form, Input, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { PageHeader } from '../components/ui/PageHeader'
import {
  aiBuildJobStatusLabel,
  aiBuildStatusLabel,
  aiCertificationLabel,
  aiFeedbackTypeLabel,
  aiMetricLabel,
  decideCertification,
  fetchAIDataProduct,
  fetchBuildJobs,
  fetchCertificationRequests,
  fetchFeedback,
  parseBuildResult,
  resolveFeedback,
  submitCertification,
  submitFeedback,
  lifecycleLabel,
  nextLifecycleTarget,
  productTypeLabel,
  type AIBuildJob,
  type AICertificationRequest,
  type AIDataProductDetail,
  type AIEvaluationFeedbackItem,
} from '../data/aiDataApi'
import { formatDateTime } from '../data/domain'
import { useAction } from '../hooks/useAction'
import { useKeyedResource } from '../hooks/useKeyedResource'
import { usePaged } from '../hooks/usePaged'
import styles from './IntegrationPages.module.css'
// 抽屉表单体系与数据接入/数据服务页同源，保持一处维护。
import formStyles from './Pages.module.css'
import localStyles from './AIDataDetailPage.module.css'

const DRAWER_WIDTH = 'min(540px, 44vw)'

interface Props {
  productId: string
  onNotice: (message: string) => void
  onAdvance: () => void
  onDeprecate: () => void
  onDemote: () => void
  onBuild: () => void
  onChanged?: () => void
}

/** AI Data Product 详情（G8/G9）：版本历史 + 生命周期操作 + build 守护提示。 */
export function AIDataDetailPage({ productId, onNotice, onAdvance, onDeprecate, onDemote, onBuild, onChanged }: Props) {
  const [detail, setDetail] = useState<AIDataProductDetail | null>(null)
  const [certifications, setCertifications] = useState<AICertificationRequest[]>([])
  const [feedback, setFeedback] = useState<AIEvaluationFeedbackItem[]>([])
  const [buildJobs, setBuildJobs] = useState<AIBuildJob[]>([])
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedbackQuestion, setFeedbackQuestion] = useState('')
  // 弃用是不可逆生命周期动作：两步确认，避免与普通动作同级误触。
  const [confirmDeprecate, setConfirmDeprecate] = useState(false)
  // 撤下重评估（G19）会中断服务：同样两步确认，与弃用同型。
  const [confirmDemote, setConfirmDemote] = useState(false)
  // 键控加载（按产品）；认证历史/反馈/构建任务是次级资源，失败不塌详情。
  const state = useKeyedResource({
    key: productId,
    load: (signal) => Promise.all([
      fetchAIDataProduct(productId, signal),
      fetchCertificationRequests(productId, signal).catch(() => []),
      fetchFeedback(productId, signal).catch(() => []),
      fetchBuildJobs(productId, signal).catch(() => []),
    ]),
    onData: ([response, requests, feedbackItems, jobs]) => {
      setDetail(response)
      setCertifications(requests)
      setFeedback(feedbackItems)
      setBuildJobs(jobs)
    },
    onReset: () => {
      setDetail(null)
      setCertifications([])
      setFeedback([])
      setBuildJobs([])
    },
  })

  // 动作互斥与错误归置统一（认证提交/反馈处置/反馈提交/审批）。
  const { pendingKey, run: runAction } = useAction((message) => onNotice(message))

  // 详情各表分页（hook 须在早退分支之前调用，读取中用空数组占位）；
  // 数据逻辑仍归 usePaged（页码钳制），渲染层交 Table 内建分页（0 基转 1 基）。
  const TABLE_PAGE_SIZE = 6
  const { page: versionsPage, setPage: setVersionsPage } = usePaged(detail?.versions ?? [], TABLE_PAGE_SIZE)
  const { page: feedbackPage, setPage: setFeedbackPage } = usePaged(feedback, TABLE_PAGE_SIZE)
  const { page: certPage, setPage: setCertPage } = usePaged(certifications, TABLE_PAGE_SIZE)
  const { page: jobsPage, setPage: setJobsPage } = usePaged(buildJobs, TABLE_PAGE_SIZE)

  function handleSubmitCertification() {
    void runAction('submit-certification', '提交失败', async () => {
      await submitCertification(productId)
      onNotice('认证审批已提交（等待审批）')
      onChanged?.()
    })
  }

  function handleResolveFeedback(feedbackId: string, consume: boolean) {
    void runAction(`resolve-${feedbackId}`, '处置失败', async () => {
      await resolveFeedback(feedbackId, consume, consume ? '已吸收进下一版本改进' : '证据不足驳回')
      onNotice(consume ? '反馈已标记吸收（由人工触发新版本与语料调整）' : '反馈已驳回')
      onChanged?.()
    })
  }

  function handleSubmitFeedback() {
    const question = feedbackQuestion.trim()
    if (!question) {
      onNotice('请先填写失败样本的问题描述')
      return
    }
    void runAction('submit-feedback', '提交失败', async () => {
      await submitFeedback(productId, {
        question,
        metric: 'faithfulness',
        feedbackType: 'CHUNK_QUALITY',
      })
      onNotice('反馈已提交（进入 Learning Plane 队列）')
      setFeedbackOpen(false)
      setFeedbackQuestion('')
      onChanged?.()
    })
  }

  function handleDecision(request: AICertificationRequest, approve: boolean) {
    void runAction(`decide-${request.id}`, '审批失败', async () => {
      await decideCertification(request.id, approve, approve ? '同意认证' : '退回：证据不足')
      onNotice(approve ? '已批准，产品进入「已认证」' : '已退回，保持「已评估」')
      onChanged?.()
    })
  }

  // 版本历史列定义：就绪度数字列右对齐 + tabular-nums；状态经中文口径映射。
  const versionColumns: ColumnsType<AIDataProductDetail['versions'][number]> = [
    { title: '版本', key: 'versionSn', render: (_, version) => version.versionSn },
    {
      title: '构建状态',
      key: 'buildStatus',
      render: (_, version) => (
        <Tag color={version.buildStatus === 'REGISTERED' ? undefined : version.buildStatus === 'FAILED' ? 'error' : version.buildStatus === 'RUNNING' ? 'warning' : 'success'}>
          {aiBuildStatusLabel[version.buildStatus] ?? version.buildStatus}
        </Tag>
      ),
    },
    {
      title: '就绪度',
      key: 'overall',
      align: 'right',
      className: localStyles.num,
      render: (_, version) => version.readiness?.overall != null ? version.readiness.overall.toFixed(2) : '—',
    },
    {
      title: '认证',
      key: 'certification',
      render: (_, version) => version.readiness?.certification
        ? (
          <Tag color={version.readiness.certification === 'BLOCKED' ? 'error' : version.readiness.certification === 'CANDIDATE' ? 'success' : 'warning'}>
            {aiCertificationLabel[version.readiness.certification] ?? version.readiness.certification}
          </Tag>
        )
        : <span>—</span>,
    },
    { title: 'Recipe', key: 'recipeRef', render: (_, version) => version.recipeRef ?? '—' },
    { title: 'Git Commit', key: 'gitCommit', render: (_, version) => version.gitCommit ?? '—' },
    { title: '创建时间', key: 'createdAt', render: (_, version) => formatDateTime(version.createdAt) },
  ]

  // 评测反馈列定义：状态三态中文口径；行内操作 size="small"。
  const feedbackColumns: ColumnsType<AIEvaluationFeedbackItem> = [
    { title: '问题', key: 'question', render: (_, item) => item.question },
    { title: '指标', key: 'metric', render: (_, item) => item.metric ? (aiMetricLabel[item.metric] ?? item.metric) : '—' },
    { title: '类型', key: 'feedbackType', render: (_, item) => aiFeedbackTypeLabel[item.feedbackType] ?? item.feedbackType },
    {
      title: '状态',
      key: 'status',
      render: (_, item) => (
        <Tag color={item.status === 'CREATED' ? 'warning' : item.status === 'CONSUMED' ? 'success' : undefined}>
          {item.status === 'CREATED' ? '待处置' : item.status === 'CONSUMED' ? '已吸收' : '已驳回'}
        </Tag>
      ),
    },
    { title: '处置说明', key: 'resolution', render: (_, item) => item.resolution ?? item.detail ?? '—' },
    {
      title: '操作',
      key: 'actions',
      render: (_, item) => item.status === 'CREATED' ? (
        <span className={styles.toolbarActions}>
          <Button size="small" onClick={() => void handleResolveFeedback(item.id, true)}>吸收</Button>
          <Button size="small" onClick={() => void handleResolveFeedback(item.id, false)}>驳回</Button>
        </span>
      ) : (item.resolvedBy ?? '—'),
    },
  ]

  // 认证审批列定义：就绪度数字列右对齐；待审批行内给出批准/退回。
  const certificationColumns: ColumnsType<AICertificationRequest> = [
    { title: '版本', key: 'versionSn', render: (_, request) => request.versionSn },
    {
      title: '就绪度',
      key: 'readinessOverall',
      align: 'right',
      className: localStyles.num,
      render: (_, request) => request.readinessOverall?.toFixed?.(2) ?? '—',
    },
    {
      title: '状态',
      key: 'decision',
      render: (_, request) => (
        <Tag color={request.decision === 'APPROVED' ? 'success' : request.decision === 'REJECTED' ? 'error' : 'warning'}>
          {request.decision === 'PENDING' ? '待审批' : request.decision === 'APPROVED' ? '已批准' : '已退回'}
        </Tag>
      ),
    },
    { title: '提交人', key: 'requestedBy', render: (_, request) => request.requestedBy },
    { title: '审批人', key: 'decidedBy', render: (_, request) => request.decidedBy ?? '—' },
    {
      title: '操作',
      key: 'actions',
      render: (_, request) => request.decision === 'PENDING' ? (
        <span className={styles.toolbarActions}>
          <Button size="small" onClick={() => void handleDecision(request, true)}>批准</Button>
          <Button size="small" onClick={() => void handleDecision(request, false)}>退回</Button>
        </span>
      ) : (request.decisionNote ?? '—'),
    },
  ]

  // 构建任务列定义：状态三态中文口径；结果列保留原拼接文案。
  const buildJobColumns: ColumnsType<AIBuildJob> = [
    {
      title: '状态',
      key: 'status',
      render: (_, job) => (
        <Tag color={job.status === 'SUCCEEDED' ? 'success' : job.status === 'FAILED' ? 'error' : 'warning'}>
          {aiBuildJobStatusLabel[job.status] ?? job.status}
        </Tag>
      ),
    },
    { title: '版本', key: 'versionSn', render: (_, job) => job.versionSn },
    { title: 'Recipe', key: 'recipeRef', render: (_, job) => job.recipeRef ?? '—' },
    {
      title: '结果',
      key: 'result',
      render: (_, job) => {
        const result = parseBuildResult(job)
        return job.status === 'FAILED'
          ? (job.error ?? '未知错误')
          : result
            ? (result.build
                ? `${result.build.chunks} chunks · RustFS ${result.build.rustfs?.version ?? '—'} · Overall ${result.overall?.toFixed?.(2) ?? '—'}`
                : `Overall ${result.overall?.toFixed?.(2) ?? '—'}`)
            : '—'
      },
    },
    { title: '发起人', key: 'createdBy', render: (_, job) => job.createdBy ?? '—' },
    { title: '开始 / 结束', key: 'startedAt', render: (_, job) => formatDateTime(job.startedAt) + ' / ' + formatDateTime(job.finishedAt) },
  ]

  if (state === 'loading' || state === 'error' || !detail) {
    return (
      <div className={styles.technicalNotice} role="status">
        <Tag color={state === 'loading' ? undefined : 'warning'}>
          {state === 'loading' ? '读取中' : '读取失败'}
        </Tag>
        <span>{state === 'loading' ? '正在读取产品详情与版本历史…' : '产品详情暂时不可读，请稍后重试。'}</span>
      </div>
    )
  }

  const { product, versions } = detail
  const nextTarget = nextLifecycleTarget(product.lifecycle)

  // 版本对比（G12 飞轮呈现面）：相邻版本的 Overall/MRR/Faithfulness 变化。
  const comparisonRows = detail.versions.map((version) => {
    const readiness = version.readiness
    if (!readiness) return null
    return {
      versionSn: version.versionSn,
      overall: readiness.overall,
      mrr: readiness.evaluation?.mrr ?? null,
      faith: readiness.evaluation?.faithfulness ?? null,
    }
  }).filter(Boolean) as { versionSn: string; overall: number | null; mrr: number | null; faith: number | null }[]

  const comparisonColumns: ColumnsType<{ versionSn: string; overall: number | null; mrr: number | null; faith: number | null }> = [
    { title: '版本', key: 'versionSn', render: (_, row) => row.versionSn },
    { title: 'Overall', key: 'overall', align: 'right', className: localStyles.num, render: (_, row) => row.overall?.toFixed(2) ?? '—' },
    { title: 'MRR', key: 'mrr', align: 'right', className: localStyles.num, render: (_, row) => row.mrr?.toFixed(2) ?? '—' },
    { title: '忠实度', key: 'faith', align: 'right', className: localStyles.num, render: (_, row) => row.faith?.toFixed(2) ?? '—' },
  ]

  return (
    <>
      <div className={styles.assetToolbar}>
        <div className={styles.assetIdentity}>
          <div className={styles.assetIdentityTop}>
            <span className={styles.assetCode}>{productTypeLabel[product.productType]}</span>
            <Tag color={product.lifecycle === 'DEPRECATED' ? 'warning' : 'success'}>
              {lifecycleLabel[product.lifecycle]}
            </Tag>
          </div>
          <h2>{product.name}</h2>
          <p>当前版本 {product.currentVersion} · 负责人 {product.owner} · 工作流 {product.workflowType}</p>
        </div>
        <div className={`${styles.toolbarActions} ${localStyles.actionBar}`}>
          <div className={localStyles.actionGroup}>
            {nextTarget ? (
              <Button size="small" onClick={onAdvance}>推进到「{lifecycleLabel[nextTarget]}」</Button>
            ) : null}
            {product.lifecycle === 'ASSESSED' ? (
              <Button size="small" onClick={() => void handleSubmitCertification()}>提交认证审批</Button>
            ) : null}
            <Button size="small" onClick={onBuild}>构建 / 评估</Button>
            <Button size="small" onClick={() => setFeedbackOpen(true)}>反馈失败样本</Button>
          </div>
          {product.lifecycle !== 'DEPRECATED' ? (
            <div className={`${localStyles.actionGroup} ${localStyles.dangerGroup}`}>
              {product.lifecycle === 'SERVING' ? (
                confirmDemote ? (
                  <>
                    <Button size="small" danger onClick={() => { setConfirmDemote(false); onDemote() }}>确认撤下</Button>
                    <Button size="small" onClick={() => setConfirmDemote(false)}>取消</Button>
                  </>
                ) : <Button size="small" onClick={() => setConfirmDemote(true)}>撤下重评估</Button>
              ) : null}
              {confirmDeprecate ? (
                <>
                  <Button size="small" danger onClick={() => { setConfirmDeprecate(false); onDeprecate() }}>确认弃用</Button>
                  <Button size="small" onClick={() => setConfirmDeprecate(false)}>取消</Button>
                </>
              ) : <Button size="small" onClick={() => setConfirmDeprecate(true)}>弃用</Button>}
            </div>
          ) : null}
        </div>
      </div>

      <div className={styles.assetBody}>
        <section className={styles.contentPanel}>
          <div className={styles.contentPanelHeader}>
            <h3>数据来源</h3>
            <span>登记口径（G8 域基础）</span>
          </div>
          <div className={styles.descriptionBlock}>
            <p>{product.sourceDesc}</p>
          </div>
        </section>

        <section className={styles.contentPanel}>
          <div className={styles.contentPanelHeader}>
            <h3>版本历史</h3>
            <span>{versions.length} 个版本 · 按创建时间升序</span>
          </div>
          <Table<AIDataProductDetail['versions'][number]>
            rowKey="id"
            columns={versionColumns}
            dataSource={versions}
            pagination={{
              current: versionsPage + 1,
              pageSize: TABLE_PAGE_SIZE,
              total: versions.length,
              showSizeChanger: false,
              onChange: (page) => setVersionsPage(page - 1),
            }}
            locale={{ emptyText: '暂无版本记录。' }}
          />
        </section>

        {(() => {
          const version = detail.versions.find((item) => item.versionSn === product.currentVersion)
          const evaluation = version?.readiness?.evaluation ?? null
          if (!evaluation) return null
          return (
            <section className={styles.contentPanel}>
              <div className={styles.contentPanelHeader}>
                <h3>评测指标（RAG Eval · 合成评测集）</h3>
                <span>评测集 {evaluation.evalSetSize ?? '—'} 问</span>
              </div>
              <div className={styles.lineageImpact}>
                <div className={styles.impactItem}><span>Recall@5</span><strong>{Number(evaluation.retrievalRecallAt5 ?? 0).toFixed(2)}</strong></div>
                <div className={styles.impactItem}><span>Precision@5</span><strong>{Number(evaluation.precisionAt5 ?? 0).toFixed(2)}</strong></div>
                <div className={styles.impactItem}><span>MRR</span><strong>{Number(evaluation.mrr ?? 0).toFixed(2)}</strong></div>
                <div className={styles.impactItem}><span>引用正确率</span><strong>{Number(evaluation.citationCorrectness ?? 0).toFixed(2)}</strong></div>
                <div className={styles.impactItem}><span>忠实度</span><strong>{Number(evaluation.faithfulness ?? 0).toFixed(2)}</strong></div>
              </div>
            </section>
          )
        })()}

        {comparisonRows.length >= 2 ? (
          <section className={styles.contentPanel}>
            <div className={styles.contentPanelHeader}>
              <h3>版本对比（数据飞轮）</h3>
              <span>就绪度与评测指标随版本演进</span>
            </div>
            <Table<{ versionSn: string; overall: number | null; mrr: number | null; faith: number | null }>
              rowKey="versionSn"
              columns={comparisonColumns}
              dataSource={comparisonRows}
              pagination={false}
              locale={{ emptyText: '暂无版本对比数据。' }}
            />
          </section>
        ) : null}

        {feedback.length > 0 ? (
          <section className={styles.contentPanel}>
            <div className={styles.contentPanelHeader}>
              <h3>评测反馈（数据飞轮 · Learning Plane）</h3>
              <span>失败样本驱动版本改进；处置只改状态，候选不自动上线</span>
            </div>
            <Table<AIEvaluationFeedbackItem>
              rowKey="id"
              columns={feedbackColumns}
              dataSource={feedback}
              pagination={{
                current: feedbackPage + 1,
                pageSize: TABLE_PAGE_SIZE,
                total: feedback.length,
                showSizeChanger: false,
                onChange: (page) => setFeedbackPage(page - 1),
              }}
              locale={{ emptyText: '暂无评测反馈。' }}
            />
          </section>
        ) : null}

        {certifications.length > 0 ? (
          <section className={styles.contentPanel}>
            <div className={styles.contentPanelHeader}>
              <h3>认证审批</h3>
              <span>{certifications.length} 条记录 · CERTIFIED 仅可经审批流转</span>
            </div>
            <Table<AICertificationRequest>
              rowKey="id"
              columns={certificationColumns}
              dataSource={certifications}
              pagination={{
                current: certPage + 1,
                pageSize: TABLE_PAGE_SIZE,
                total: certifications.length,
                showSizeChanger: false,
                onChange: (page) => setCertPage(page - 1),
              }}
              locale={{ emptyText: '暂无认证审批记录。' }}
            />
          </section>
        ) : null}

        {buildJobs.length > 0 ? (
          <section className={styles.contentPanel}>
            <div className={styles.contentPanelHeader}>
              <h3>构建任务</h3>
              <span>{buildJobs.length} 条记录 · 最近在前（G20 任务态异步化：排队 → 执行 → 终态）</span>
            </div>
            <Table<AIBuildJob>
              rowKey="id"
              columns={buildJobColumns}
              dataSource={buildJobs}
              pagination={{
                current: jobsPage + 1,
                pageSize: TABLE_PAGE_SIZE,
                total: buildJobs.length,
                showSizeChanger: false,
                onChange: (page) => setJobsPage(page - 1),
              }}
              locale={{ emptyText: '暂无构建任务。' }}
            />
          </section>
        ) : null}

        <section className={styles.technicalNotice} role="status">
          <Tag color="warning">评估引擎</Tag>
          <span>构建/评估委托 AI Ready 引擎（G9）执行，任务态异步推进（G20）：结论回写当前版本的就绪度列，进度经「构建任务」追读；引擎未配置时投递返回明确的 503 而不伪造成功。</span>
        </section>
      </div>

      <Drawer
        open={feedbackOpen}
        destroyOnHidden
        width={DRAWER_WIDTH}
        title={<DrawerTitle eyebrow="评测反馈" title="反馈失败样本" />}
        onClose={() => setFeedbackOpen(false)}
        footer={<><Button onClick={() => setFeedbackOpen(false)}>取消</Button><Button type="primary" htmlType="submit" form="ai-feedback-form" loading={pendingKey === 'submit-feedback'}>{pendingKey === 'submit-feedback' ? '提交中…' : '提交反馈'}</Button></>}
      >
        <Form id="ai-feedback-form" layout="vertical" onFinish={() => handleSubmitFeedback()}>
          <div className={formStyles.drawerNotice}><CircleAlert size={16} /><span>反馈进入 Learning Plane 队列，由人工决定吸收进下一版本；指标固定为忠实度（faithfulness），类型为检索片段质量。</span></div>
          <Form.Item label="失败样本问题（评测明细中的问题）">
            <Input.TextArea rows={6} value={feedbackQuestion} onChange={(event) => setFeedbackQuestion(event.target.value)} placeholder="粘贴评测明细中回答错误的问题原文" spellCheck={false} />
          </Form.Item>
        </Form>
      </Drawer>
    </>
  )
}

/** 抽屉标题：眉标 + 主标题，对齐原自研 Drawer 的标题结构。 */
function DrawerTitle({ eyebrow, title }: { eyebrow: ReactNode; title: ReactNode }) {
  return <div><span className={formStyles.drawerEyebrow}>{eyebrow}</span><h2 style={{ margin: '4px 0 0', fontSize: 16, fontWeight: 600 }}>{title}</h2></div>
}
