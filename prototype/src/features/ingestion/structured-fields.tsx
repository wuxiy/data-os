import { useMutation, useQuery } from '@tanstack/react-query'
import { useForm } from '@tanstack/react-form'
import { CircleAlert, FlaskConical, Play, Table2 } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { FormField, FormGrid, FormNotice } from '../../components/ui/form'
import { CodeTextarea, Input, NativeSelect } from '../../components/ui/input'
import { LoadingInline } from '../../components/ui/states'
import { cn } from '../../lib/utils'
import {
  runSourceQuery,
  type SourceApiItem,
  type StructuredTaskSpec,
} from '../../data/controlPlane'
import { formatDateTime } from '../../data/domain'
import { sourceCatalogsQuery, sourceColumnsQuery, sourceTablesQuery } from './queries'
import { errorMessage } from './labels'

export interface StructuredValues {
  form: 'TABLE' | 'SQL'
  catalog: string
  tables: string[]
  columns: string[]
  mode: 'FULL' | 'INCREMENTAL'
  orderKey: string
  customSql: string
  targetDatabase: string
  targetTable: string
  sinkFenodes: string
  sinkCredentialRef: string
}

const emptyValues: StructuredValues = {
  form: 'TABLE',
  catalog: '',
  tables: [],
  columns: [],
  mode: 'FULL',
  orderKey: '',
  customSql: '',
  targetDatabase: '',
  targetTable: '',
  sinkFenodes: '',
  sinkCredentialRef: '',
}

function valuesFromSpec(spec: StructuredTaskSpec | null): StructuredValues {
  if (!spec) return emptyValues
  return {
    form: spec.form,
    catalog: spec.catalog ?? '',
    tables: spec.tables ?? [],
    columns: spec.columns ?? [],
    mode: spec.mode,
    orderKey: spec.orderKey ?? '',
    customSql: spec.customSql ?? '',
    targetDatabase: spec.targetDatabase ?? '',
    targetTable: spec.targetTable ?? '',
    sinkFenodes: spec.sinkFenodes ?? '',
    sinkCredentialRef: spec.sinkCredentialRef ?? '',
  }
}

function specFromValues(values: StructuredValues, source: SourceApiItem, activeColumns: boolean): StructuredTaskSpec {
  return {
    form: values.form,
    sourceId: source.id,
    catalog: values.catalog || undefined,
    tables: values.form === 'TABLE' ? values.tables : undefined,
    columns: values.form === 'TABLE' && activeColumns ? values.columns : undefined,
    orderKey: values.form === 'TABLE' && values.mode === 'INCREMENTAL' ? values.orderKey || undefined : undefined,
    mode: values.mode,
    customSql: values.form === 'SQL' ? values.customSql : undefined,
    targetDatabase: values.targetDatabase || undefined,
    targetTable: values.targetTable || (values.form === 'TABLE' && values.tables.length === 1 ? values.tables[0] : undefined),
    sinkFenodes: values.sinkFenodes.trim(),
    sinkCredentialRef: values.sinkCredentialRef.trim(),
  }
}

/**
 * 结构化任务表单（表 / SQL 双形态）：门户只收集意图，库表实校验与编译在控制面完成。
 * 表形态支持多选表批量建任务（由调用方拆成多个作业）；编辑已存意图时形态锁定。
 * 校验挂在 TanStack Form 上：提交前拦截、错误就近显示、脏状态供工作页退出守卫使用。
 */
export function StructuredTaskFields({
  source,
  initial,
  lastSuccessWatermark,
  saving,
  submitLabel,
  submitHint,
  onSubmit,
  onDirtyChange,
  onCancel,
}: {
  source: SourceApiItem
  initial: StructuredTaskSpec | null
  lastSuccessWatermark: string | null
  saving: boolean
  submitLabel: string
  submitHint?: string
  onSubmit: (spec: StructuredTaskSpec) => void
  onDirtyChange?: (dirty: boolean) => void
  onCancel?: () => void
}) {
  const editLocked = initial !== null
  const submitRef = useRef(onSubmit)
  submitRef.current = onSubmit

  const form = useForm({
    defaultValues: valuesFromSpec(initial),
    validators: {
      onSubmit: ({ value }) => {
        if (!value.sinkFenodes.trim()) return '请填写目标仓库 FE 地址（凭据只写引用）'
        if (!value.sinkCredentialRef.trim()) return '请填写目标仓库凭据引用'
        if (value.form === 'SQL') {
          if (!value.customSql.trim()) return '请填写只读查询语句'
          if (!value.targetTable.trim()) return 'SQL 任务需要填写目标表名'
        } else {
          if (value.tables.length === 0) return '请至少选择一个源表'
          if (value.mode === 'INCREMENTAL' && !value.orderKey) return '增量采集需要选择一个时间类型序列键'
        }
        return undefined
      },
    },
    onSubmit: ({ value }) => {
      const values = value as StructuredValues
      submitRef.current(specFromValues(values, source, values.form === 'TABLE' && values.tables.length === 1))
    },
  })

  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  const values = form.state.values
  const catalogsQuery = useQuery(sourceCatalogsQuery(source.id))
  const activeTable = editLocked || values.tables.length === 1 ? values.tables[0] : undefined
  const tablesQuery = useQuery(sourceTablesQuery(source.id, values.catalog))
  const columnsQuery = useQuery(sourceColumnsQuery(source.id, values.catalog, activeTable ?? ''))
  const activeColumns = activeTable ? columnsQuery.data?.columns : undefined

  const timeColumns = useMemo(() => (activeColumns ?? [])
    .filter((column) => column.typeName.toUpperCase().includes('DATE') || column.typeName.toUpperCase().includes('TIMESTAMP'))
    .map((column) => column.name), [activeColumns])

  const sqlTest = useMutation({
    mutationFn: (sql: string) => runSourceQuery(source.id, { sql, catalog: values.catalog || undefined, maxRows: 5 }),
  })

  function toggleTable(table: string) {
    const current = form.getFieldValue('tables')
    if (current.includes(table)) {
      form.setFieldValue('tables', current.filter((item) => item !== table))
      form.setFieldValue('columns', [])
      form.setFieldValue('orderKey', '')
      return
    }
    const next = editLocked ? [table] : [...current, table]
    form.setFieldValue('tables', next)
    form.setFieldValue('columns', [])
    form.setFieldValue('orderKey', '')
  }

  function toggleColumn(column: string) {
    const current = form.getFieldValue('columns')
    form.setFieldValue('columns', current.includes(column) ? current.filter((item) => item !== column) : [...current, column])
  }

  const canSubmit = !saving && form.state.values.form !== undefined

  return (
    <form
      id="structured-task-form"
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void form.handleSubmit()
      }}
      onChange={() => onDirtyChange?.(form.state.isDirty)}
    >
      {lastSuccessWatermark ? (
        <FormNotice icon={<CircleAlert />}>
          上次成功水位：{formatDateTime(lastSuccessWatermark)}。增量任务从该时间点继续回放；重新保存配置不会重置进度。
        </FormNotice>
      ) : null}

      <FormField label="任务形态">
        <div role="radiogroup" aria-label="任务形态" className="inline-flex gap-1 rounded-control border border-[#e3e7ee] bg-wash p-0.5">
          {([
            { value: 'TABLE' as const, label: '表任务', icon: <Table2 size={13} /> },
            { value: 'SQL' as const, label: 'SQL 任务', icon: <Play size={13} /> },
          ]).map((option) => {
            const active = values.form === option.value
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={editLocked}
                onClick={() => form.setFieldValue('form', option.value)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-chip px-2.5 py-1 text-label',
                  active ? 'bg-paper text-blue shadow-focus' : 'text-[#7a8491] hover:text-ink',
                  editLocked && 'opacity-60',
                )}
              >
                {option.icon}{option.label}
              </button>
            )
          })}
        </div>
      </FormField>

      {values.form === 'TABLE' ? (
        <>
          <FormGrid>
            <FormField label="源库" htmlFor="structured-catalog">
              <NativeSelect
                id="structured-catalog"
                className="min-h-[35px]"
                value={values.catalog}
                onChange={(event) => {
                  form.setFieldValue('catalog', event.target.value)
                  form.setFieldValue('tables', [])
                  form.setFieldValue('columns', [])
                  form.setFieldValue('orderKey', '')
                }}
              >
                <option value="">{catalogsQuery.isPending ? '读取中…' : '选择库'}</option>
                {(catalogsQuery.data?.catalogs ?? []).map((catalog) => <option key={catalog} value={catalog}>{catalog}</option>)}
              </NativeSelect>
              {catalogsQuery.isError ? <p className="mt-1 text-meta text-red">库清单读取失败，请确认连接配置</p> : null}
            </FormField>
            <FormField label="采集方式" htmlFor="structured-mode">
              <NativeSelect
                id="structured-mode"
                className="min-h-[35px]"
                value={values.mode}
                onChange={(event) => form.setFieldValue('mode', event.target.value as 'FULL' | 'INCREMENTAL')}
              >
                <option value="FULL">全量（幂等唯一键目标模型可重跑）</option>
                <option value="INCREMENTAL">增量（时间序列键水位回放）</option>
              </NativeSelect>
            </FormField>
          </FormGrid>

          {values.catalog ? (
            <FormField label={`源表${editLocked ? '' : '（可多选，每表一个任务）'}`}>
              {tablesQuery.isPending ? <LoadingInline>正在读取表清单…</LoadingInline> : (
                <div className="flex flex-wrap gap-1.5">
                  {(tablesQuery.data?.tables ?? []).map((table) => (
                    <button
                      key={table.name}
                      type="button"
                      title={table.remark || table.type}
                      aria-pressed={values.tables.includes(table.name)}
                      onClick={() => toggleTable(table.name)}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-chip border border-line px-2 py-1 text-label hover:border-[#c7d4e8]',
                        values.tables.includes(table.name) ? 'border-blue-line bg-blue-soft text-blue' : 'bg-paper text-[#5b6b80]',
                      )}
                    >
                      <Table2 size={12} />{table.name}
                    </button>
                  ))}
                  {(tablesQuery.data?.tables.length ?? 0) === 0 && !tablesQuery.isPending ? <p className="text-label text-muted">该库没有可采集的表</p> : null}
                </div>
              )}
              {tablesQuery.data?.truncated ? <p className="mt-1 text-meta text-amber">表数量较多，仅显示前 500 个</p> : null}
            </FormField>
          ) : null}

          {activeColumns ? (
            <FormField label={`字段白名单（不选 = 全部字段）${columnsQuery.isFetching ? ' · 读取中…' : ''}`}>
              <div className="flex max-h-[220px] flex-wrap gap-1.5 overflow-y-auto rounded-control border border-line bg-wash p-2.5">
                {activeColumns.map((column) => (
                  <label key={column.name} className="inline-flex items-center gap-1.5 rounded-chip bg-paper px-2 py-1 text-label text-[#5b6b80]">
                    <input
                      type="checkbox"
                      className="size-[13px] accent-blue"
                      checked={values.columns.includes(column.name)}
                      onChange={() => toggleColumn(column.name)}
                    />
                    <span>{column.name}</span>
                    <small className="text-meta text-[#98a2ae]">{column.typeName}</small>
                  </label>
                ))}
              </div>
            </FormField>
          ) : values.tables.length > 1 ? (
            <p className="mb-4 text-label text-muted">多表批量任务使用全量字段；如需字段白名单或增量序列键，请单选表配置。</p>
          ) : null}

          {values.mode === 'INCREMENTAL' && activeColumns !== undefined ? (
            <FormField label="增量序列键（时间类型）" htmlFor="structured-order-key">
              <NativeSelect
                id="structured-order-key"
                className="min-h-[35px]"
                value={values.orderKey}
                onChange={(event) => form.setFieldValue('orderKey', event.target.value)}
              >
                <option value="">选择序列键</option>
                {timeColumns.map((column) => <option key={column} value={column}>{column}</option>)}
              </NativeSelect>
              {timeColumns.length === 0 ? <p className="mt-1 text-meta text-amber">该表没有时间类型字段；整数序列键不支持增量回放，请改用全量。</p> : null}
            </FormField>
          ) : null}
        </>
      ) : (
        <>
          <FormField
            label="查询语句（只读 · 单条 SELECT/WITH）"
            htmlFor="structured-sql"
            hint={sqlTest.data ? `可执行：${sqlTest.data.columns.length} 列 × ${sqlTest.data.rows.length} 行样本${sqlTest.data.truncated ? '（已截断）' : ''}` : sqlTest.error ? errorMessage(sqlTest.error, '测试失败') : undefined}
          >
            <div className="mb-1.5 flex justify-end">
              <Button
                size="sm"
                variant="text"
                disabled={!values.customSql.trim() || sqlTest.isPending}
                onClick={() => sqlTest.mutate(values.customSql)}
              >
                <FlaskConical size={13} />{sqlTest.isPending ? '测试中…' : '测试 SQL'}
              </Button>
            </div>
            <CodeTextarea
              id="structured-sql"
              className="min-h-[180px]"
              value={values.customSql}
              onChange={(event) => form.setFieldValue('customSql', event.target.value)}
              placeholder="例如：SELECT id, name FROM patient_info WHERE update_time >= '${last_success_time}'"
            />
          </FormField>
          <FormField label="目标表名" htmlFor="structured-sql-target">
            <Input id="structured-sql-target" value={values.targetTable} onChange={(event) => form.setFieldValue('targetTable', event.target.value)} placeholder="例如：src_patient_overview" />
          </FormField>
        </>
      )}

      <FormGrid>
        {values.form === 'TABLE' ? (
          <FormField label="目标表名（缺省 = 源表名）" htmlFor="structured-target-table">
            <Input id="structured-target-table" value={values.targetTable} onChange={(event) => form.setFieldValue('targetTable', event.target.value)} placeholder={activeTable ?? '与源表同名'} />
          </FormField>
        ) : null}
        <FormField label="目标库（缺省按系统类型命名）" htmlFor="structured-target-database">
          <Input id="structured-target-database" value={values.targetDatabase} onChange={(event) => form.setFieldValue('targetDatabase', event.target.value)} placeholder={`ods_${source.systemType.toLowerCase()}`} />
        </FormField>
      </FormGrid>
      <FormGrid>
        <FormField label="目标仓库 FE 地址" htmlFor="structured-fenodes">
          <Input id="structured-fenodes" value={values.sinkFenodes} onChange={(event) => form.setFieldValue('sinkFenodes', event.target.value)} placeholder="例如：doris-fe.internal:8030" />
        </FormField>
        <FormField label="目标仓库凭据引用" htmlFor="structured-sink-credential">
          <Input id="structured-sink-credential" value={values.sinkCredentialRef} onChange={(event) => form.setFieldValue('sinkCredentialRef', event.target.value)} placeholder="已登记凭据的引用 id" />
        </FormField>
      </FormGrid>

      <form.Subscribe selector={(state) => state.errors}>
        {(errors) => errors.length > 0
          ? <p role="alert" className="mb-3 text-body-sm text-[#b04747]">{errors[0]}</p>
          : null}
      </form.Subscribe>

      <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
        <span className="text-meta text-[#788495]">{submitHint ?? '凭据只保存引用；编译后的作业 JSON 由控制面持有'}</span>
        <div className="flex items-center gap-2">
          {onCancel ? <Button onClick={onCancel} disabled={saving}>取消</Button> : null}
          <Button type="submit" variant="primary" disabled={!canSubmit || saving}>
            {saving ? '保存中…' : submitLabel}
          </Button>
        </div>
      </div>
      <p className="mt-2 text-meta text-[#98a2ae]">
        <Badge tone="blue">结构化意图</Badge> 表单只声明采集口径，库表与字段由控制面对源实校验后编译。
      </p>
    </form>
  )
}
