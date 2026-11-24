import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { CodeTextarea } from '@/components/app/code-textarea'
import { Badge } from '@/components/ui/badge'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Cable, CheckCircle2, CircleAlert, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { FormField } from '../../components/kit/form'
import { NativeSelect } from '../../components/kit/input'
import { Dialog, DialogFooter } from '../../components/kit/overlay'
import { useNotice } from '../../components/kit/toast'
import {
  checkSource,
  copyIngestionJob,
  createSource,
  type IngestionJobApiItem,
  type SourceApiItem,
} from '../../data/controlPlane'
import { formatDateTime } from '../../data/domain'
import { ingestionKeys } from './queries'
import { errorMessage, parseConfig, sourceCheckDefaults, sourceDisplayName, sourceStatusView } from './labels'

const SYSTEM_TYPES = ['LIS', 'EMR', 'HIS', 'PACS']
const PROTOCOLS = ['JDBC', 'HTTP', 'FHIR', 'SFTP']

/** 数据源登记（3 字段短表单）：提交后为「待检查」，不读取院内数据。 */
export function SourceRegisterDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (source: SourceApiItem) => void
}) {
  const queryClient = useQueryClient()
  const notify = useNotice()
  const [form, setForm] = useState({ name: '', systemType: 'LIS', protocol: 'JDBC' })
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => createSource({ name: form.name.trim(), systemType: form.systemType, protocol: form.protocol }),
    onSuccess: (source) => {
      void queryClient.invalidateQueries({ queryKey: ingestionKeys.sources() })
      onCreated(source)
      notify('数据源已登记，状态为待检查')
      setForm({ name: '', systemType: 'LIS', protocol: 'JDBC' })
      setError(null)
      onOpenChange(false)
    },
    onError: (cause) => setError(errorMessage(cause, '数据源登记失败，请检查控制面连接')),
  })

  const dirty = Boolean(form.name.trim())

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="登记数据源"
      description="登记来源系统与接入方式；提交后为待检查，不会立即读取院内数据。"
      width={540}
      dirty={dirty && !mutation.isPending}
      footer={
        <DialogFooter note="登记与连通性检查分开呈现">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>取消</Button>
          <Button
            disabled={!form.name.trim() || mutation.isPending}
            onClick={() => { setError(null); mutation.mutate() }}
          >
            {mutation.isPending ? '登记中…' : '登记来源'}
          </Button>
        </DialogFooter>
      }
    >
      <Alert variant="info" role="note" className="mb-4">
        <Cable />
        <AlertDescription>系统类型与接入协议决定后续可用的配置形态；凭据只以引用形式登记，不写入来源记录。</AlertDescription>
      </Alert>
      <FormField label="来源名称" required htmlFor="source-name">
        <Input
          id="source-name"
          value={form.name}
          onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
          placeholder="例如：检验前置机"
        />
      </FormField>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="系统类型" htmlFor="source-system">
          <NativeSelect id="source-system" value={form.systemType} onChange={(event) => setForm((current) => ({ ...current, systemType: event.target.value }))}>
            {SYSTEM_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </NativeSelect>
        </FormField>
        <FormField label="接入协议" htmlFor="source-protocol">
          <NativeSelect id="source-protocol" value={form.protocol} onChange={(event) => setForm((current) => ({ ...current, protocol: event.target.value }))}>
            {PROTOCOLS.map((protocol) => <option key={protocol} value={protocol}>{protocol}</option>)}
          </NativeSelect>
        </FormField>
      </div>
      {error ? (
        <Alert variant="error" className="mt-3">
          <CircleAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </Dialog>
  )
}

/** 数据源检查：一次请求到结果；检查参数只在当前请求使用。 */
export function SourceCheckDialog({
  source,
  onOpenChange,
  onChecked,
}: {
  source: SourceApiItem | null
  onOpenChange: (open: boolean) => void
  onChecked: (source: SourceApiItem) => void
}) {
  const queryClient = useQueryClient()
  const notify = useNotice()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!source) return
    setText(JSON.stringify(sourceCheckDefaults(source.protocol), null, 2))
    setError(null)
  }, [source])

  const mutation = useMutation({
    mutationFn: (payload: { id: string; config: Record<string, unknown> }) => checkSource(payload.id, payload.config),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: ingestionKeys.sources() })
      onChecked(updated)
      notify(`数据源检查完成：${sourceStatusView(updated.status).label}`)
      setError(null)
    },
    onError: (cause) => setError(errorMessage(cause, '数据源检查失败，请稍后重试')),
  })

  function submit() {
    if (!source) return
    let config: Record<string, unknown>
    try {
      config = parseConfig(text)
    } catch (cause) {
      setError(errorMessage(cause, '检查配置 JSON 不合法'))
      return
    }
    setError(null)
    mutation.mutate({ id: source.id, config })
  }

  const status = source ? sourceStatusView(source.status) : null

  return (
    <Dialog
      open={source !== null}
      onOpenChange={onOpenChange}
      title={source ? `${sourceDisplayName(source)} · ${source.protocol}` : '数据源检查'}
      description="检查只在当前请求中使用连接参数，不会把密码或 Token 写入来源记录。"
      width={540}
      footer={
        <DialogFooter note="结果回写为健康、失败或待配置">
          <Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
          <Button onClick={submit} disabled={mutation.isPending || !source}>
            <CheckCircle2 size={14} />{mutation.isPending ? '检查中…' : '开始检查'}
          </Button>
        </DialogFooter>
      }
    >
      <FormField label="检查配置 JSON" htmlFor="source-check-config">
        <CodeTextarea
          id="source-check-config"
          value={text}
          onChange={(event) => setText(event.target.value)}
          disabled={mutation.isPending}
          className="min-h-[200px]"
        />
      </FormField>
      {error ? (
        <Alert variant="error" className="mb-3">
          <CircleAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {source?.lastCheckMessage ? (
        <div className="rounded-control border border-line bg-wash px-3 py-2.5">
          <div className="flex items-center gap-2">
            {status ? <Badge variant={status.tone}>{status.label}</Badge> : null}
            <span className="text-label text-ink-soft">{source.lastCheckMessage}</span>
          </div>
          <p className="mt-1 text-meta text-muted-foreground">最近检查：{formatDateTime(source.lastCheckedAt)}</p>
        </div>
      ) : null}
    </Dialog>
  )
}

/** 任务复制（2 字段）：副本不继承运行历史。 */
export function CopyJobDialog({
  job,
  sources,
  onOpenChange,
  onCopied,
}: {
  job: IngestionJobApiItem | null
  sources: SourceApiItem[]
  onOpenChange: (open: boolean) => void
  onCopied: (job: IngestionJobApiItem) => void
}) {
  const queryClient = useQueryClient()
  const notify = useNotice()
  const [form, setForm] = useState({ sourceId: '', name: '' })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!job) return
    setForm({ sourceId: job.sourceId, name: `${job.name}-副本` })
    setError(null)
  }, [job])

  const mutation = useMutation({
    mutationFn: () => copyIngestionJob(job!.id, { sourceId: form.sourceId || undefined, name: form.name.trim() || undefined }),
    onSuccess: (copy) => {
      void queryClient.invalidateQueries({ queryKey: ingestionKeys.jobs() })
      onCopied(copy)
      notify(`任务已复制：${copy.name}${copy.configured ? '' : '（配置未随行，请检查）'}`)
      setError(null)
      onOpenChange(false)
    },
    onError: (cause) => setError(errorMessage(cause, '任务复制失败，请稍后重试')),
  })

  const dirty = Boolean(job && form.name !== `${job.name}-副本`)

  return (
    <Dialog
      open={job !== null}
      onOpenChange={onOpenChange}
      title={job ? `复制任务 · ${job.name}` : '复制任务'}
      description="结构化任务复制后会对目标源重新校验库表字段；副本以草稿落库，不继承运行历史。"
      width={540}
      dirty={dirty && !mutation.isPending}
      footer={
        <DialogFooter note="副本保留配置，不带运行记录">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>取消</Button>
          <Button onClick={() => { setError(null); mutation.mutate() }} disabled={mutation.isPending || !job}>
            <Copy size={14} />{mutation.isPending ? '复制中…' : '创建副本'}
          </Button>
        </DialogFooter>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <FormField label="目标数据源" htmlFor="copy-source">
          <NativeSelect
            id="copy-source"
            className="min-h-[35px]"
            value={form.sourceId}
            onChange={(event) => setForm((current) => ({ ...current, sourceId: event.target.value }))}
          >
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {sourceDisplayName(source)} · {source.systemType}{source.connection ? '' : ' · 未登记连接'}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label="副本名称" htmlFor="copy-name">
          <Input id="copy-name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
        </FormField>
      </div>
      {error ? (
        <Alert variant="error" className="mt-3">
          <CircleAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </Dialog>
  )
}
