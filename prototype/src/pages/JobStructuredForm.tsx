import { CircleAlert, FlaskConical, Play, Table2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchSourceCatalogs,
  fetchSourceColumns,
  fetchSourceTables,
  runSourceQuery,
  type SourceApiItem,
  type SourceColumnApiItem,
  type StructuredTaskSpec,
} from '../data/controlPlane'
import { formatDateTime } from '../data/domain'
import styles from './Pages.module.css'

interface Props {
  source: SourceApiItem
  /** 编辑回填的结构化意图；新建传 null。存在时表单形态锁定。 */
  initial: StructuredTaskSpec | null
  lastSuccessWatermark: string | null
  saving: boolean
  error: string | null
  onSubmit: (spec: StructuredTaskSpec) => void
}

/**
 * 结构化任务表单（G2G 批次 1 第二刀）：表/SQL 双形态、字段白名单、增量序列键。
 * 门户只收集意图，编译与目录实校验在控制面完成（保存报错如实呈现）。
 * 表形态支持多选表批量建任务（onSubmit 的 spec.tables 由页面拆成多个作业）。
 */
export function JobStructuredForm({ source, initial, lastSuccessWatermark, saving, error, onSubmit }: Props) {
  const [form, setForm] = useState<'TABLE' | 'SQL'>(initial?.form ?? 'TABLE')
  const [catalogs, setCatalogs] = useState<string[] | null>(null)
  const [catalog, setCatalog] = useState(initial?.catalog ?? '')
  const [tables, setTables] = useState<Record<string, string[]>>({})
  const [selectedTables, setSelectedTables] = useState<string[]>(initial?.tables ?? [])
  const [columnsByTable, setColumnsByTable] = useState<Record<string, SourceColumnApiItem[]>>({})
  const [columnsLoading, setColumnsLoading] = useState(false)
  const [selectedColumns, setSelectedColumns] = useState<string[]>(initial?.columns ?? [])
  const [mode, setMode] = useState<'FULL' | 'INCREMENTAL'>(initial?.mode ?? 'FULL')
  const [orderKey, setOrderKey] = useState(initial?.orderKey ?? '')
  const [customSql, setCustomSql] = useState(initial?.customSql ?? '')
  const [sqlTest, setSqlTest] = useState<{ state: 'idle' | 'running' | 'ok' | 'error'; message: string }>({ state: 'idle', message: '' })
  const [targetDatabase, setTargetDatabase] = useState(initial?.targetDatabase ?? '')
  const [targetTable, setTargetTable] = useState(initial?.targetTable ?? '')
  const [sinkFenodes, setSinkFenodes] = useState(initial?.sinkFenodes ?? '')
  const [sinkCredentialRef, setSinkCredentialRef] = useState(initial?.sinkCredentialRef ?? '')
  const editLocked = initial !== null

  // 库清单懒加载；下游状态只在「源真正切换」时重置——以「上次源 id」判定而非
  // 首帧标记（StrictMode 双调用会把首帧标记吃掉，回到挂载即清空的缺陷）。
  const lastSourceId = useRef(source.id)
  useEffect(() => {
    if (lastSourceId.current !== source.id) {
      lastSourceId.current = source.id
      setTables({})
      setSelectedTables([])
      setColumnsByTable({})
      setSelectedColumns([])
    }
    const controller = new AbortController()
    setCatalogs(null)
    fetchSourceCatalogs(source.id, controller.signal)
      .then((response) => {
        setCatalogs(response.catalogs)
      })
      .catch(() => {
        if (!controller.signal.aborted) setCatalogs([])
      })
    return () => controller.abort()
  }, [source.id])

  // 展开库 → 拉表清单（懒加载、按库缓存）；编辑回填时自动选中已存库
  useEffect(() => {
    if (catalogs === null || !catalog) return
    if (!tables[catalog] && !columnsByTable[catalog]) {
      fetchSourceTables(source.id, catalog)
        .then((response) => setTables((current) => ({ ...current, [catalog]: response.tables.map((item) => item.name) }))
        ).catch(() => setTables((current) => ({ ...current, [catalog]: [] })))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogs, catalog])

  // 编辑回填：把已存表与白名单列的元数据拉齐（序列键过滤依赖列类型）
  useEffect(() => {
    if (!editLocked || !catalog || selectedTables.length === 0) return
    const table = selectedTables[0]
    if (columnsByTable[table]) return
    fetchSourceColumns(source.id, catalog, table)
      .then((response) => setColumnsByTable((current) => ({ ...current, [table]: response.columns })))
      .catch(() => setColumnsByTable((current) => ({ ...current, [table]: [] })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editLocked, catalog, selectedTables])

  async function selectCatalog(nextCatalog: string) {
    setCatalog(nextCatalog)
    setSelectedTables([])
    setSelectedColumns([])
    if (!nextCatalog || tables[nextCatalog]) return
    try {
      const response = await fetchSourceTables(source.id, nextCatalog)
      setTables((current) => ({ ...current, [nextCatalog]: response.tables.map((item) => item.name) }))
    } catch {
      setTables((current) => ({ ...current, [nextCatalog]: [] }))
    }
  }

  // 多选表（批量建任务）；单表时载入字段清单供白名单/序列键选择
  async function toggleTable(table: string) {
    setSelectedTables((current) => {
      if (current.includes(table)) return current.filter((item) => item !== table)
      if (editLocked) return [table]
      return [...current, table]
    })
    if (!columnsByTable[table]) {
      setColumnsLoading(true)
      try {
        const response = await fetchSourceColumns(source.id, catalog, table)
        setColumnsByTable((current) => ({ ...current, [table]: response.columns }))
      } catch {
        setColumnsByTable((current) => ({ ...current, [table]: [] }))
      } finally {
        setColumnsLoading(false)
      }
    }
  }

  const activeTable = editLocked || selectedTables.length === 1 ? selectedTables[0] : undefined
  const activeColumns = activeTable ? columnsByTable[activeTable] : undefined
  const timeColumns = useMemo(() => (activeColumns ?? [])
    .filter((column) => column.typeName.toUpperCase().includes('DATE')
      || column.typeName.toUpperCase().includes('TIMESTAMP'))
    .map((column) => column.name), [activeColumns])

  function toggleColumn(column: string) {
    setSelectedColumns((current) =>
      current.includes(column) ? current.filter((item) => item !== column) : [...current, column])
  }

  async function testSql() {
    if (!customSql.trim()) return
    setSqlTest({ state: 'running', message: '测试中…' })
    try {
      const result = await runSourceQuery(source.id, { sql: customSql, catalog: catalog || undefined, maxRows: 5 })
      setSqlTest({
        state: 'ok',
        message: `可执行：${result.columns.length} 列 × ${result.rows.length} 行样本${result.truncated ? '（已截断）' : ''}`,
      })
    } catch (cause) {
      setSqlTest({ state: 'error', message: cause instanceof Error ? cause.message : '测试失败' })
    }
  }

  function submit() {
    const spec: StructuredTaskSpec = {
      form,
      sourceId: source.id,
      catalog,
      tables: form === 'TABLE' ? selectedTables : undefined,
      columns: form === 'TABLE' && activeColumns ? selectedColumns : undefined,
      orderKey: form === 'TABLE' && mode === 'INCREMENTAL' ? orderKey : undefined,
      mode,
      customSql: form === 'SQL' ? customSql : undefined,
      targetDatabase: targetDatabase || undefined,
      targetTable: form === 'SQL' ? targetTable : (targetTable || undefined),
      sinkFenodes,
      sinkCredentialRef,
    }
    onSubmit(spec)
  }

  const canSubmit = !saving && Boolean(sinkFenodes.trim()) && Boolean(sinkCredentialRef.trim())
    && (form === 'SQL'
      ? Boolean(customSql.trim()) && Boolean(targetTable.trim())
      : selectedTables.length > 0 && (mode === 'FULL' || Boolean(orderKey)))

  return (
    <div className={styles.structuredForm}>
      {lastSuccessWatermark ? (
        <div className={styles.drawerNotice}><CircleAlert size={16} /><span>上次成功水位：{formatDateTime(lastSuccessWatermark)}。增量任务从该时间点继续回放；重新保存配置不会重置进度。</span></div>
      ) : null}
      <div className={styles.formField}>
        <label>任务形态</label>
        <div className={styles.structuredModeSwitch} role="radiogroup" aria-label="任务形态">
          <button type="button" role="radio" aria-checked={form === 'TABLE'} disabled={editLocked}
            className={`${styles.structuredModeButton} ${form === 'TABLE' ? styles.structuredModeActive : ''}`}
            onClick={() => setForm('TABLE')}><Table2 size={13} />表任务</button>
          <button type="button" role="radio" aria-checked={form === 'SQL'} disabled={editLocked}
            className={`${styles.structuredModeButton} ${form === 'SQL' ? styles.structuredModeActive : ''}`}
            onClick={() => setForm('SQL')}><Play size={13} />SQL 任务</button>
        </div>
      </div>

      {form === 'TABLE' ? (
        <>
          <div className={styles.drawerFormGrid}>
            <div className={styles.formField}>
              <label htmlFor="structured-catalog">源库</label>
              <select id="structured-catalog" value={catalog} onChange={(event) => void selectCatalog(event.target.value)}>
                <option value="">{catalogs === null ? '读取中…' : '选择库'}</option>
                {catalogs?.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </div>
            <div className={styles.formField}>
              <label htmlFor="structured-mode">采集方式</label>
              <select id="structured-mode" value={mode} onChange={(event) => setMode(event.target.value as 'FULL' | 'INCREMENTAL')}>
                <option value="FULL">全量（幂等唯一键目标模型可重跑）</option>
                <option value="INCREMENTAL">增量（时间序列键水位回放）</option>
              </select>
            </div>
          </div>
          {catalog ? (
            <div className={styles.formField}>
              <label>源表{editLocked ? '' : '（可多选，每表一个任务）'}</label>
              {tables[catalog] === undefined ? <p className={styles.drawerHint}>正在读取表清单…</p> : (
                <div className={styles.structuredTablePicker}>
                  {tables[catalog]?.map((table) => (
                    <button type="button" key={table}
                      className={`${styles.explorerChip} ${selectedTables.includes(table) ? styles.explorerChipActive : ''}`}
                      onClick={() => void toggleTable(table)}>
                      <Table2 size={12} />{table}
                    </button>
                  ))}
                  {tables[catalog]?.length === 0 ? <p className={styles.drawerHint}>该库没有可采集的表</p> : null}
                </div>
              )}
            </div>
          ) : null}
          {activeColumns ? (
            <div className={styles.formField}>
              <label>字段白名单（不选 = 全部字段）{columnsLoading ? ' · 读取中…' : ''}</label>
              <div className={styles.structuredColumnPicker}>
                {activeColumns.map((column) => (
                  <label key={column.name} className={styles.structuredColumnOption}>
                    <input type="checkbox" checked={selectedColumns.includes(column.name)}
                      onChange={() => toggleColumn(column.name)} />
                    <span>{column.name}</span>
                    <small>{column.typeName}</small>
                  </label>
                ))}
              </div>
            </div>
          ) : selectedTables.length > 1 ? (
            <p className={styles.drawerHint}>多表批量任务使用全量字段；如需字段白名单或增量序列键，请单选表配置。</p>
          ) : null}
          {mode === 'INCREMENTAL' && activeColumns !== undefined ? (
            <div className={styles.formField}>
              <label htmlFor="structured-order-key">增量序列键（时间类型）</label>
              <select id="structured-order-key" value={orderKey} onChange={(event) => setOrderKey(event.target.value)}>
                <option value="">选择序列键</option>
                {timeColumns.map((column) => <option key={column} value={column}>{column}</option>)}
              </select>
              {timeColumns.length === 0 ? <p className={styles.drawerHint}>该表没有时间类型字段；整数序列键不支持增量回放，请改用全量。</p> : null}
            </div>
          ) : null}
        </>
      ) : (
        <>
          <div className={styles.formField}>
            <div className={styles.structuredSqlHeader}>
              <label htmlFor="structured-sql">查询语句（只读 · 单条 SELECT/WITH）</label>
              <button type="button" className={styles.tableButton} disabled={!customSql.trim() || sqlTest.state === 'running'} onClick={() => void testSql()}>
                <FlaskConical size={13} />{sqlTest.state === 'running' ? '测试中…' : '测试 SQL'}
              </button>
            </div>
            <textarea id="structured-sql" className={`${styles.codeInput} ${styles.codeInputLarge}`}
              value={customSql} onChange={(event) => setCustomSql(event.target.value)} spellCheck={false}
              placeholder="例如：SELECT id, name FROM patient_info WHERE update_time >= '${last_success_time}'" />
            {sqlTest.state !== 'idle' && sqlTest.message ? (
              <p className={sqlTest.state === 'error' ? styles.formError : styles.drawerHint} role={sqlTest.state === 'error' ? 'alert' : undefined}>{sqlTest.message}</p>
            ) : null}
          </div>
          <div className={styles.formField}>
            <label htmlFor="structured-sql-target">目标表名</label>
            <input id="structured-sql-target" value={targetTable} onChange={(event) => setTargetTable(event.target.value)} placeholder="例如：src_patient_overview" />
          </div>
        </>
      )}

      <div className={styles.drawerFormGrid}>
        {form === 'TABLE' ? (
          <div className={styles.formField}>
            <label htmlFor="structured-target-table">目标表名（缺省 = 源表名）</label>
            <input id="structured-target-table" value={targetTable} onChange={(event) => setTargetTable(event.target.value)} placeholder={activeTable ?? '与源表同名'} />
          </div>
        ) : null}
        <div className={styles.formField}>
          <label htmlFor="structured-target-database">目标库（缺省按系统类型命名）</label>
          <input id="structured-target-database" value={targetDatabase} onChange={(event) => setTargetDatabase(event.target.value)} placeholder={`ods_${source.systemType.toLowerCase()}`} />
        </div>
      </div>
      <div className={styles.drawerFormGrid}>
        <div className={styles.formField}>
          <label htmlFor="structured-fenodes">目标仓库 FE 地址</label>
          <input id="structured-fenodes" value={sinkFenodes} onChange={(event) => setSinkFenodes(event.target.value)} placeholder="例如：doris-fe.internal:8030" />
        </div>
        <div className={styles.formField}>
          <label htmlFor="structured-sink-credential">目标仓库凭据引用</label>
          <input id="structured-sink-credential" value={sinkCredentialRef} onChange={(event) => setSinkCredentialRef(event.target.value)} placeholder="已登记凭据的引用 id" />
        </div>
      </div>
      {error ? <p className={styles.formError} role="alert">{error}</p> : null}
      <button type="button" className={styles.primaryButton} disabled={!canSubmit} onClick={submit}>
        <Play size={14} />{saving ? '保存中…' : form === 'TABLE' && !editLocked && selectedTables.length > 1 ? `创建 ${selectedTables.length} 个任务` : '保存任务配置'}
      </button>
    </div>
  )
}
