import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { CodeTextarea } from '@/components/app/code-textarea'
import { useMutation } from '@tanstack/react-query'
import { useQueryClient } from '@tanstack/react-query'
import { CircleAlert, Save, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { FormField, FormGrid } from '../../components/kit/form'

import { Breadcrumb, PageHeading } from '../../components/app/page-heading'
import { Panel } from '../../components/kit/panel'
import { useNotice } from '../../components/kit/toast'
import { createDataService } from '../../data/dataServicesApi'
import { usePortalNavigate } from '../../app/navigate'
import { dataServiceKeys } from './queries'

/**
 * 新建数据服务（独立工作页）：SQL 模板、参数契约、列契约、行数与超时一并定义。
 * 参数/列契约为 JSON 数组，保存前本地校验语法；服务端仍做最终校验。
 */
export function ServiceEditorPage() {
  const navigate = usePortalNavigate()
  const queryClient = useQueryClient()
  const notify = useNotice()

  const [form, setForm] = useState({
    code: '',
    name: '',
    description: '',
    sqlTemplate: '',
    parameters: '[{"name":"start_date","type":"date","required":true,"description":"开始日期"}]',
    columns: '[{"name":"stat_date","type":"date","description":"统计日期"}]',
    maxRows: '1000',
    timeoutSeconds: '30',
    owner: 'data-team',
  })
  const [error, setError] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: () => {
      let parameters: unknown
      let columns: unknown
      try {
        parameters = JSON.parse(form.parameters)
        columns = JSON.parse(form.columns)
      } catch {
        throw new Error('参数契约与列契约必须是合法 JSON 数组')
      }
      if (!Array.isArray(parameters) || !Array.isArray(columns)) throw new Error('参数契约与列契约必须是 JSON 数组')
      return createDataService({
        code: form.code.trim(),
        name: form.name.trim(),
        description: form.description.trim(),
        sqlTemplate: form.sqlTemplate.trim(),
        parameters: parameters as never,
        columns: columns as never,
        maxRows: Number(form.maxRows) || 1000,
        timeoutSeconds: Number(form.timeoutSeconds) || 30,
        owner: form.owner.trim(),
      })
    },
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: dataServiceKeys.all })
      notify(`已创建数据服务（草稿）：${created.code}`)
      navigate('/data-services')
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : '创建失败'),
  })

  function submit() {
    if (!form.code.trim() || !form.name.trim() || !form.sqlTemplate.trim() || !form.owner.trim()) {
      setError('请完整填写代码、名称、负责人与 SQL 模板')
      return
    }
    if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(form.code.trim())) {
      setError('服务代码须为小写字母/数字/连字符，长度 3–64')
      return
    }
    setError(null)
    create.mutate()
  }

  return (
    <div>
      <Breadcrumb items={[{ label: '数据应用' }, { label: '数据服务' }, { label: '新建数据服务' }]} />
      <PageHeading
        title="新建数据服务"
        description="定义 ToB 数据 API 的 SQL、参数与列契约、返回行数与超时；创建后为草稿，发布才对调用方开放。"
        actions={<Button variant="outline" onClick={() => navigate('/data-services')}>返回目录</Button>}
      />

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3.5 max-[1100px]:grid-cols-1">
        <Panel>
          <div className="px-5 py-4">
            <Alert variant="info" role="note" className="mb-4">
              <ShieldCheck />
              <AlertDescription>
                服务执行使用只读账号；参数为命名占位（如 :start_date），由调用方按契约传入。发布后定义变更会形成合同事件。
              </AlertDescription>
            </Alert>
            <FormGrid>
              <FormField label="服务代码" required htmlFor="service-code" hint="小写字母/数字/连字符，创建后不可修改">
                <Input id="service-code" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="medicine-record-daily" />
              </FormField>
              <FormField label="服务名称" required htmlFor="service-name">
                <Input id="service-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="每日用药记录统计" />
              </FormField>
            </FormGrid>
            <FormField label="服务说明" htmlFor="service-description">
              <Input id="service-description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="口径、数据范围与使用注意" />
            </FormField>
            <FormField label="SQL 模板" required htmlFor="service-sql" hint="单条只读 SELECT/WITH；参数用命名占位">
              <CodeTextarea id="service-sql" className="min-h-[180px]" value={form.sqlTemplate} onChange={(event) => setForm({ ...form, sqlTemplate: event.target.value })} placeholder={'SELECT stat_date, COUNT(*) AS cnt FROM dws_medicine_day WHERE stat_date BETWEEN :start_date AND :end_date GROUP BY stat_date'} />
            </FormField>
            <FormGrid>
              <FormField label="行数上限" htmlFor="service-max-rows">
                <Input id="service-max-rows" type="number" min={1} value={form.maxRows} onChange={(event) => setForm({ ...form, maxRows: event.target.value })} />
              </FormField>
              <FormField label="超时（秒）" htmlFor="service-timeout">
                <Input id="service-timeout" type="number" min={1} value={form.timeoutSeconds} onChange={(event) => setForm({ ...form, timeoutSeconds: event.target.value })} />
              </FormField>
            </FormGrid>
            <FormField label="负责人" required htmlFor="service-owner">
              <Input id="service-owner" value={form.owner} onChange={(event) => setForm({ ...form, owner: event.target.value })} placeholder="data-team" />
            </FormField>
          </div>
        </Panel>

        <Panel>
          <div className="px-5 py-4">
            <FormField label="参数契约（JSON 数组）" htmlFor="service-parameters" hint='每项：{"name","type":"string|number|date|boolean","required","description","values","defaultValue"}'>
              <CodeTextarea id="service-parameters" className="min-h-[220px]" value={form.parameters} onChange={(event) => setForm({ ...form, parameters: event.target.value })} />
            </FormField>
            <FormField label="列契约（JSON 数组）" htmlFor="service-columns" hint='每项：{"name","type","description"}'>
              <CodeTextarea id="service-columns" className="min-h-[180px]" value={form.columns} onChange={(event) => setForm({ ...form, columns: event.target.value })} />
            </FormField>
            {error ? (
              <Alert variant="error" className="mb-3">
                <CircleAlert />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
              <span className="text-meta text-muted-foreground">创建后为草稿；发布前可继续调整</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => navigate('/data-services')} disabled={create.isPending}>取消</Button>
                <Button disabled={create.isPending} onClick={submit}>
                  <Save size={14} />{create.isPending ? '创建中…' : '创建服务（草稿）'}
                </Button>
              </div>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  )
}
