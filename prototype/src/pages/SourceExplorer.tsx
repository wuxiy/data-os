import { ChevronDown, ChevronRight, Database, Play, Table2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  fetchSourceCatalogs,
  fetchSourceColumns,
  fetchSourceTables,
  runSourceQuery,
  saveSourceConnection,
  type SourceApiItem,
  type SourceColumnApiItem,
  type SourceQueryResultApiItem,
  type SourceTableApiItem,
} from '../data/controlPlane'
import { useAction } from '../hooks/useAction'
import local from './SourceExplorer.module.css'
import styles from './Pages.module.css'

interface Props {
  source: SourceApiItem
  onNotice: (message: string) => void
  onSourceUpdated: (source: SourceApiItem) => void
}

/**
 * 数据源浏览与受控 SQL 工作台（G2G 批次 1 第一刀）：库 → 表两级懒加载树、
 * 选中表字段清单、只读查询（单条 SELECT/WITH，行数上限与超时由服务端强制）。
 * 浏览前需登记非敏感连接配置（jdbcUrl / username / credentialRef）；明文
 * 密码不落库，由服务端拒绝并提示走凭据引用。
 */
export function SourceExplorer({ source, onNotice, onSourceUpdated }: Props) {
  const connected = Boolean(source.connection)
  return connected
    ? <SourceExplorerWorkspace source={source} onNotice={onNotice} />
    : <SourceConnectionForm source={source} onNotice={onNotice} onSourceUpdated={onSourceUpdated} />
}

/** 连接登记表单：浏览的工作连接来源，只保存非敏感键。 */
function SourceConnectionForm({ source, onNotice, onSourceUpdated }: Props) {
  const [form, setForm] = useState({ jdbcUrl: '', username: '', credentialRef: '' })
  const { pendingKey, error, run } = useAction()
  const saving = pendingKey === 'save-connection'

  useEffect(() => {
    // 同协议的检查配置默认值口径一致，降低登记门槛。
    if (source.protocol.toUpperCase() === 'JDBC') {
      setForm((current) => current.jdbcUrl ? current : { ...current, jdbcUrl: 'jdbc:postgresql://主机:5432/数据库' })
    }
  }, [source.protocol])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!form.jdbcUrl.trim()) return
    const config: Record<string, unknown> = { jdbcUrl: form.jdbcUrl.trim() }
    if (form.username.trim()) config.username = form.username.trim()
    if (form.credentialRef.trim()) config.credentialRef = form.credentialRef.trim()
    await run('save-connection', '连接登记失败，请稍后重试', async () => {
      const updated = await saveSourceConnection(source.id, config)
      onSourceUpdated(updated)
      onNotice('连接配置已登记，可以开始浏览库表')
    })
  }

  return (
    <form id="source-connection-form" className={styles.drawerForm} onSubmit={(event) => void submit(event)}>
      <div className={styles.drawerNotice}><Database size={16} /><span>浏览前先登记连接参数。仅保存库地址与账号引用；密码、Secret 请经凭据服务以 credentialRef 引用，本表单不落库明文凭据。</span></div>
      <div className={styles.formField}><label htmlFor="explorer-jdbc-url">连接地址（JDBC URL）</label><input id="explorer-jdbc-url" required value={form.jdbcUrl} onChange={(event) => setForm((current) => ({ ...current, jdbcUrl: event.target.value }))} placeholder="jdbc:postgresql://主机:5432/数据库" /></div>
      <div className={styles.formField}><label htmlFor="explorer-username">用户名（只读账号）</label><input id="explorer-username" value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} placeholder="例如：dataos_ro" /></div>
      <div className={styles.formField}><label htmlFor="explorer-credential-ref">凭据引用</label><input id="explorer-credential-ref" value={form.credentialRef} onChange={(event) => setForm((current) => ({ ...current, credentialRef: event.target.value }))} placeholder="已登记凭据的引用名（密码经凭据服务托管）" /></div>
      {error ? <p className={styles.formError} role="alert">{error}</p> : null}
      {saving ? <p className={styles.drawerHint} role="status">登记中…</p> : null}
    </form>
  )
}

/** 浏览工作区：目录树 + 字段清单 + SQL 工作台。 */
function SourceExplorerWorkspace({ source, onNotice }: Omit<Props, 'onSourceUpdated'>) {
  const [catalogs, setCatalogs] = useState<string[] | null>(null)
  const [catalogsError, setCatalogsError] = useState<string | null>(null)
  const [expandedCatalog, setExpandedCatalog] = useState<string | null>(null)
  const [tablesByCatalog, setTablesByCatalog] = useState<Record<string, SourceTableApiItem[]>>({})
  const [tablesError, setTablesError] = useState<string | null>(null)
  const [selectedTable, setSelectedTable] = useState<{ catalog: string; table: string } | null>(null)
  const [columns, setColumns] = useState<SourceColumnApiItem[] | null>(null)
  const [columnsLoading, setColumnsLoading] = useState(false)
  const [sql, setSql] = useState('')
  const [result, setResult] = useState<SourceQueryResultApiItem | null>(null)
  const { pendingKey, error: queryError, run: runQueryAction } = useAction()
  const querying = pendingKey === 'run-query'

  useEffect(() => {
    const controller = new AbortController()
    fetchSourceCatalogs(source.id, controller.signal)
      .then((response) => {
        setCatalogs(response.catalogs)
        setCatalogsError(response.truncated ? '库数量较多，仅显示前 200 个' : null)
      })
      .catch(() => {
        if (!controller.signal.aborted) setCatalogsError('库清单读取失败，请确认连接配置后重试')
      })
    return () => controller.abort()
  }, [source.id])

  async function toggleCatalog(catalog: string) {
    if (expandedCatalog === catalog) {
      setExpandedCatalog(null)
      return
    }
    setExpandedCatalog(catalog)
    setTablesError(null)
    if (tablesByCatalog[catalog]) return
    try {
      const response = await fetchSourceTables(source.id, catalog)
      setTablesByCatalog((current) => ({ ...current, [catalog]: response.tables }))
      if (response.truncated) setTablesError('表数量较多，仅显示前 500 个')
    } catch {
      setTablesError('表清单读取失败，请稍后重试')
    }
  }

  async function selectTable(catalog: string, table: string) {
    setSelectedTable({ catalog, table })
    setColumns(null)
    setColumnsLoading(true)
    setSql(`SELECT * FROM ${table} LIMIT 100`)
    try {
      const response = await fetchSourceColumns(source.id, catalog, table)
      setColumns(response.columns)
    } catch {
      onNotice('字段清单读取失败，请稍后重试')
    } finally {
      setColumnsLoading(false)
    }
  }

  async function executeQuery() {
    if (!sql.trim()) return
    const catalog = selectedTable?.catalog ?? expandedCatalog ?? undefined
    await runQueryAction('run-query', '查询执行失败，请查看错误提示', async () => {
      const response = await runSourceQuery(source.id, { sql, catalog })
      setResult(response)
      onNotice(response.truncated ? '查询完成，结果已按行数上限截断' : '查询完成')
    })
  }

  return (
    <div className={styles.explorerBody}>
      {catalogsError ? <p className={styles.formError} role="alert">{catalogsError}</p> : null}
      <div className={styles.explorerTree}>
        {catalogs === null ? <p className={styles.drawerHint}>正在读取库清单…</p> : null}
        {catalogs !== null && catalogs.length === 0 ? <div className={styles.emptyState}><Database size={18} /><p>该数据源未返回任何库</p><span>请确认连接地址与账号权限。</span></div> : null}
        {catalogs?.map((catalog) => {
          const expanded = expandedCatalog === catalog
          const tables = tablesByCatalog[catalog]
          return (
            <div key={catalog} className={styles.explorerCatalog}>
              <button type="button" className={styles.explorerCatalogRow} aria-expanded={expanded} onClick={() => void toggleCatalog(catalog)}>
                {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <Database size={14} />
                <span>{catalog}</span>
              </button>
              {expanded ? (
                <div className={styles.explorerTableList}>
                  {tables === undefined ? <p className={styles.drawerHint}>正在读取表清单…</p> : null}
                  {tables?.length === 0 ? <p className={styles.drawerHint}>该库没有可浏览的表</p> : null}
                  {tables?.map((table) => (
                    <button type="button" key={table.name}
                      className={`${styles.explorerChip} ${selectedTable?.catalog === catalog && selectedTable.table === table.name ? styles.explorerChipActive : ''}`}
                      title={table.remark || table.type}
                      onClick={() => void selectTable(catalog, table.name)}>
                      <Table2 size={12} />{table.name}
                    </button>
                  ))}
                  {tablesError && tables ? <p className={styles.formError}>{tablesError}</p> : null}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      {selectedTable ? (
        <div className={styles.explorerColumnsBlock}>
          <div className={styles.explorerSectionTitle}><Table2 size={14} /><strong>{selectedTable.table}</strong><span>字段清单</span></div>
          {columnsLoading ? <p className={styles.drawerHint}>正在读取字段清单…</p> : null}
          {columns ? (
            columns.length === 0 ? <p className={styles.drawerHint}>未读取到字段信息</p> : (
              <div className={styles.explorerColumnsScroll}><table className={styles.table}><thead><tr><th>字段</th><th>类型</th><th>可空</th><th>注释</th></tr></thead><tbody>
                {columns.map((column) => (
                  <tr key={column.name}><td><strong>{column.name}</strong></td><td>{column.typeName}</td><td>{column.nullable ? '是' : '否'}</td><td>{column.remark || '—'}</td></tr>
                ))}
              </tbody></table></div>
            )
          ) : null}
        </div>
      ) : null}

      <div className={styles.explorerQueryBlock}>
        <div className={styles.explorerSectionTitle}><Play size={14} /><strong>SQL 工作台</strong><span>只读 · 单条查询 · 行数上限 200</span>{selectedTable ? <span className={local.sectionMeta}>当前库：{selectedTable.catalog}</span> : null}</div>
        <textarea id="explorer-sql" className={`${styles.codeInput} ${styles.codeInputLarge}`} value={sql}
          onChange={(event) => setSql(event.target.value)} spellCheck={false}
          placeholder="例如：SELECT * FROM 表名 LIMIT 100" aria-label="SQL 查询语句" />
        <div className={styles.explorerQueryActions}>
          <button type="button" className={styles.primaryButton} disabled={querying || !sql.trim()} onClick={() => void executeQuery()}>
            <Play size={13} />{querying ? '查询中…' : '执行查询'}
          </button>
        </div>
        {queryError ? <p className={styles.formError} role="alert">{queryError}</p> : null}
        {result ? (
          <div className={styles.explorerResultBlock}>
            {result.truncated ? <p className={styles.explorerResultNote} role="status">结果超出返回上限，已截断显示前 {result.rows.length} 行。</p> : null}
            {result.rows.length === 0 ? <p className={styles.drawerHint}>查询没有返回数据行。</p> : (
              <div className={styles.explorerResultScroll}><table className={styles.table}><thead><tr>{result.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>
                {result.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell ?? '—'}</td>)}</tr>
                ))}
              </tbody></table></div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
