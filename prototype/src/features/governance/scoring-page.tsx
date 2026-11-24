import { LoadingBlock } from '@/components/app/loading'
import { Input } from '@/components/ui/input'
import { FrameDescription, FrameHeader, FramePanel } from '@/components/ui/frame'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPopup, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleAlert, Gauge, Plus, Save } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { FormGrid } from '@/components/app/form-grid'

import { Breadcrumb, PageHeading } from '../../components/app/page-heading'

import { useNotice } from '@/components/app/notice'
import { updateQualityScoreStandard, type QualityGradeView } from '../../data/controlPlane'
import { formatDateTime } from '../../data/domain'
import { usePortalNavigate } from '../../app/navigate'
import { governanceKeys, qualityScoreQuery } from './queries'
import { QUALITY_DIMENSIONS } from './quality-score-panel'

/**
 * 质量评分设置（独立配置页，替代旧抽屉）：
 * 通过线 / 六维权重 / 等级表单一旦保存即按新标准重算，因此保存处呈现在影响摘要，
 * 离开前对未保存修改做确认。
 */
export function ScoringPage() {
  const navigate = usePortalNavigate()
  const queryClient = useQueryClient()
  const notify = useNotice()
  const query = useQuery(qualityScoreQuery())

  const [passScore, setPassScore] = useState('60')
  const [weights, setWeights] = useState<Record<string, string>>({})
  const [grades, setGrades] = useState<QualityGradeView[]>([])
  const [error, setError] = useState<string | null>(null)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [initialized, setInitialized] = useState(false)

  useEffect(() => {
    const standard = query.data?.standard
    if (!standard || initialized) return
    setPassScore(String(standard.passScore))
    setWeights(Object.fromEntries(QUALITY_DIMENSIONS.map((dimension) => [dimension, String(standard.weights[dimension] ?? 1)])))
    setGrades(standard.grades)
    setInitialized(true)
  }, [query.data, initialized])

  const mutation = useMutation({
    mutationFn: () => updateQualityScoreStandard({
      passScore: Number(passScore),
      weights: Object.fromEntries(QUALITY_DIMENSIONS.map((dimension) => [dimension, Number(weights[dimension] ?? 1)])),
      grades: grades.map((grade) => ({ grade: grade.grade.trim(), lowScore: Number(grade.lowScore) })),
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: governanceKeys.score() })
      notify('评分标准已更新，总分与等级已按新标准重算')
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : '评分标准保存失败，请稍后重试'),
  })

  function submit() {
    const validScore = (value: string | number) => String(value).trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100
    if (!validScore(passScore)) { setError('请填写 0–100 之间的规则通过线。'); return }
    if (QUALITY_DIMENSIONS.some((dimension) => !validScore(weights[dimension] ?? '') || !Number.isInteger(Number(weights[dimension])))) {
      setError('每个维度的权重须为 0–100 之间的整数。'); return
    }
    if (grades.length === 0 || grades.some((grade) => !grade.grade.trim() || !validScore(grade.lowScore))) {
      setError('请填写等级名称及 0–100 之间的最低分，或移除未使用的等级。'); return
    }
    if (new Set(grades.map((grade) => grade.grade.trim())).size !== grades.length) {
      setError('等级名称不能重复。'); return
    }
    setError(null)
    mutation.mutate()
  }

  const dirty = initialized && (
    passScore !== String(query.data?.standard.passScore ?? '')
    || JSON.stringify(grades) !== JSON.stringify(query.data?.standard.grades ?? [])
    || QUALITY_DIMENSIONS.some((dimension) => weights[dimension] !== String(query.data?.standard.weights[dimension] ?? 1))
  )

  function leave() {
    if (dirty) { setDiscardOpen(true); return }
    navigate('/governance/quality')
  }

  if (query.isPending) return <LoadingBlock>正在读取评分标准…</LoadingBlock>

  return (
    <div>
      <Breadcrumb items={[{ label: '数据治理' }, { label: '数据质量' }, { label: '评分标准' }]} trailing={query.data ? <span>标准更新 {formatDateTime(query.data.standard.updatedAt)}</span> : null} />
      <PageHeading
        title="质量评分设置"
        description="维度分 = 维度内规则得分均值；总分 = 维度加权平均；等级按最低分阈值从高到低判定。"
        actions={<Button variant="outline" onClick={leave}>返回质量工作台</Button>}
      />

      <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-3.5 max-[1100px]:grid-cols-1">
        <FramePanel className="p-0 overflow-clip">
          <FrameHeader className="px-[18px] pt-[18px] pb-3 gap-1">
            <div className="min-w-0">
              <h2 className="text-title font-semibold tracking-[-0.2px]">
                通过线与维度权重
              </h2>
              <FrameDescription>标准单一生效，保存后立即重算总分与等级</FrameDescription>
            </div>
          </FrameHeader>
          <div className="px-5 pb-5">
            <Alert variant="info" role="note" className="mb-4">
              <Gauge />
              <AlertDescription>
                无终态运行的规则不计入维度均值；权重全为 1 时即等权平均。修改标准不影响历史运行记录，只影响下一次评分读数的计算口径。
              </AlertDescription>
            </Alert>
            <Field className="mb-4">
              <FieldLabel>
                规则通过线（0-100） <span className="text-destructive-foreground">*</span>
              </FieldLabel>
              <Input id="pass-score" type="number" min={0} max={100} value={passScore} onChange={(event) => setPassScore(event.target.value)} className="w-[160px]" />
            </Field>
            <FormGrid>
              {QUALITY_DIMENSIONS.map((dimension) => (
                <Field key={dimension}>
                  <FieldLabel>{dimension}</FieldLabel>
                  <Input
                    id={`weight-${dimension}`}
                    type="number"
                    min={0}
                    max={100}
                    value={weights[dimension] ?? '1'}
                    aria-label={`${dimension}权重`}
                    onChange={(event) => setWeights((current) => ({ ...current, [dimension]: event.target.value }))}
                  />
                </Field>
              ))}
            </FormGrid>
          </div>
        </FramePanel>

        <FramePanel className="p-0 overflow-clip">
          <FrameHeader className="px-[18px] pt-[18px] pb-3 flex-row items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-title font-semibold tracking-[-0.2px]">
                等级表
                {grades.length !== undefined ? <Badge variant="outline">{grades.length}</Badge> : null}
              </h2>
              <FrameDescription>按最低分从高到低判定</FrameDescription>
            </div>
            <div className="flex shrink-0 items-center gap-2">{<Button variant="outline" size="sm" onClick={() => setGrades((current) => [...current, { grade: '', lowScore: 0 }])}><Plus size={13} />添加等级</Button>}</div>
          </FrameHeader>
          <div className="px-5 pb-5">
            {grades.map((grade, index) => (
              <div key={index} className="mb-2 grid grid-cols-[minmax(0,1fr)_120px_auto] items-center gap-2">
                <Input
                  aria-label={`等级 ${index + 1} 名称`}
                  value={grade.grade}
                  onChange={(event) => setGrades((current) => current.map((item, i) => i === index ? { ...item, grade: event.target.value } : item))}
                  placeholder="等级名称，例如 A"
                />
                <Input
                  type="number"
                  min={0}
                  max={100}
                  aria-label={`等级 ${index + 1} 最低分`}
                  value={grade.lowScore}
                  onChange={(event) => setGrades((current) => current.map((item, i) => i === index ? { ...item, lowScore: Number(event.target.value) } : item))}
                />
                <Button size="sm" variant="link" disabled={grades.length <= 1} aria-label={`移除等级 ${index + 1}`} onClick={() => setGrades((current) => current.filter((_, i) => i !== index))}>移除</Button>
              </div>
            ))}
            {grades.length === 0 ? <p className="py-6 text-center text-label text-muted-foreground">至少保留一个等级；等级名称不能重复。</p> : null}

            <div className="mt-4 rounded-control border border-line bg-wash px-3 py-2.5 text-label text-muted-foreground">
              <strong className="block text-body-sm text-ink-soft">保存影响</strong>
              <p className="mt-1">保存后立即按新标准重算总分与等级；<Badge variant="warning">受影响</Badge> 只影响评分读数，不重跑规则、不改变已产生的治理问题。</p>
            </div>

            {error ? (
              <Alert variant="error" className="mt-3">
                <CircleAlert />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <div className="mt-4 flex justify-end gap-2 border-t border-line pt-4">
              <Button variant="outline" onClick={leave}>取消</Button>
              <Button disabled={mutation.isPending || !initialized} onClick={submit}>
                <Save size={14} />{mutation.isPending ? '保存中…' : '保存并重算'}
              </Button>
            </div>
          </div>
        </FramePanel>
      </div>

      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogPopup closeProps={{ 'aria-label': '关闭' }}>
          <DialogHeader>
            <DialogTitle>放弃未保存的评分标准？</DialogTitle>
            <DialogDescription>离开后本页未保存的通过线、权重与等级会丢失；已生效的评分标准不受影响。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiscardOpen(false)}>继续编辑</Button>
            <Button variant="destructive" onClick={() => { setDiscardOpen(false); navigate('/governance/quality') }}>放弃修改</Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  )
}
