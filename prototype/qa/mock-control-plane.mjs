#!/usr/bin/env node
/**
 * 前端迁移 QA 用的控制面替身（仅验收环境，不进入生产构建）。
 *
 * 目的：在没有后端的环境里按**真实契约形状**返回合成记录，让浏览器验收能覆盖
 * 列表、短表单、工作页与动作回执；合成数据只存在于本进程，不写入任何业务库。
 *
 * 用法（在 prototype/ 下）：
 *   node qa/mock-control-plane.mjs --port 18090
 *   VITE_DATAOS_API_BASE_URL=http://127.0.0.1:18090/api npm run build
 *   node qa/browser-smoke.mjs --serve
 */
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'

const args = process.argv.slice(2)
const portIndex = args.indexOf('--port')
const port = portIndex >= 0 ? Number(args[portIndex + 1]) : 18090

const now = () => new Date().toISOString()

const sources = [
  {
    id: 'src-lis-001', tenantId: 'tenant-demo', institutionId: 'INST-001', name: '检验信息系统 LIS',
    systemType: 'LIS', protocol: 'JDBC', status: 'HEALTHY', createdAt: '2026-10-01T02:10:00Z',
    lastCheckedAt: '2026-11-16T01:30:00Z', lastCheckMessage: '连接成功，只读账号可用',
    connection: { jdbcUrl: 'jdbc:postgresql://lis.internal:5432/lis', username: 'dataos_ro', credentialRef: 'cred-lis-ro' },
  },
  {
    id: 'src-emr-002', tenantId: 'tenant-demo', institutionId: 'INST-001', name: '电子病历 EMR',
    systemType: 'EMR', protocol: 'JDBC', status: 'BLOCKED_CONFIGURATION', createdAt: '2026-10-02T03:00:00Z',
    lastCheckedAt: null, lastCheckMessage: null, connection: null,
  },
  {
    id: 'src-fhir-003', tenantId: 'tenant-demo', institutionId: 'INST-001', name: '区域交换网关 FHIR',
    systemType: 'HIS', protocol: 'FHIR', status: 'UNHEALTHY', createdAt: '2026-10-03T03:00:00Z',
    lastCheckedAt: '2026-11-15T22:00:00Z', lastCheckMessage: 'HTTP 403：前置机白名单未放行',
    connection: null,
  },
]

const jobs = [
  {
    id: 'job-lab-result-001', sourceId: 'src-lis-001', name: '检验报告结果采集', mode: 'BATCH', executor: 'SEATUNNEL',
    status: 'ACTIVE', createdAt: '2026-10-04T01:00:00Z', latestRunStatus: 'SUCCEEDED', lastRunAt: '2026-11-16T01:12:00Z',
    templateKey: 'STRUCTURED_JDBC_TO_DORIS', templateVersion: 1, configured: true,
  },
  {
    id: 'job-outpatient-visit-002', sourceId: 'src-lis-001', name: '门诊就诊记录增量采集', mode: 'CDC', executor: 'SEATUNNEL',
    status: 'ACTIVE', createdAt: '2026-10-05T01:00:00Z', latestRunStatus: 'RUNNING', lastRunAt: '2026-11-16T02:10:00Z',
    templateKey: 'STRUCTURED_JDBC_TO_DORIS', templateVersion: 2, configured: true,
  },
  {
    id: 'job-inpatient-record-003', sourceId: 'src-emr-002', name: '住院病历每日同步', mode: 'BATCH', executor: 'SEATUNNEL',
    status: 'PAUSED', createdAt: '2026-10-06T01:00:00Z', latestRunStatus: 'FAILED', lastRunAt: '2026-11-15T18:00:00Z',
    templateKey: null, templateVersion: null, configured: false,
  },
  {
    id: 'job-ds-workflow-004', sourceId: 'src-lis-001', name: '药品目录平台调度同步', mode: 'BATCH', executor: 'DOLPHINSCHEDULER',
    status: 'ACTIVE', createdAt: '2026-10-07T01:00:00Z', latestRunStatus: null, lastRunAt: null,
    templateKey: 'CUSTOM', templateVersion: 1, configured: true,
  },
]

const runs = {
  'job-lab-result-001': [
    { id: 'run-0004-lab', jobId: 'job-lab-result-001', status: 'SUCCEEDED', executor: 'SEATUNNEL', externalId: 'ext-8812', message: '采集完成，写入 12,860 行', reconciliationStatus: null, reconciliationMessage: null, submittedAt: '2026-11-16T01:10:00Z', startedAt: '2026-11-16T01:11:00Z', finishedAt: '2026-11-16T01:12:00Z' },
    { id: 'run-0003-lab', jobId: 'job-lab-result-001', status: 'SUCCEEDED', executor: 'SEATUNNEL', externalId: 'ext-8801', message: '采集完成，写入 12,404 行', reconciliationStatus: null, reconciliationMessage: null, submittedAt: '2026-11-15T01:10:00Z', startedAt: '2026-11-15T01:11:00Z', finishedAt: '2026-11-15T01:12:00Z' },
  ],
  'job-outpatient-visit-002': [
    { id: 'run-0007-visit', jobId: 'job-outpatient-visit-002', status: 'RUNNING', executor: 'SEATUNNEL', externalId: 'ext-8830', message: '增量批次执行中', reconciliationStatus: null, reconciliationMessage: null, submittedAt: '2026-11-16T02:10:00Z', startedAt: '2026-11-16T02:11:00Z', finishedAt: null },
  ],
  'job-inpatient-record-003': [
    { id: 'run-0002-inpat', jobId: 'job-inpatient-record-003', status: 'FAILED', executor: 'SEATUNNEL', externalId: null, message: '连接超时：住院 EMR 前置机未响应', reconciliationStatus: 'MANUAL_REQUIRED', reconciliationMessage: '执行器状态无法确认，请先核对外部运行是否存在。', submittedAt: '2026-11-15T18:00:00Z', startedAt: null, finishedAt: null },
    { id: 'run-0009-inpat', jobId: 'job-inpatient-record-003', status: 'UNKNOWN', executor: 'SEATUNNEL', externalId: null, message: '提交后未收到执行器回执', reconciliationStatus: 'MANUAL_REQUIRED', reconciliationMessage: '请确认外部运行不存在后再重试。', submittedAt: '2026-11-14T18:00:00Z', startedAt: null, finishedAt: null },
  ],
  'job-ds-workflow-004': [],
}

const configs = {
  'job-lab-result-001': {
    jobId: 'job-lab-result-001', templateKey: 'STRUCTURED_JDBC_TO_DORIS', templateVersion: 1,
    config: { source: [{ plugin_name: 'Jdbc', jdbc_url: 'jdbc:postgresql://lis.internal:5432/lis' }], sink: [{ plugin_name: 'Doris', fenodes: 'doris-fe:8030', table: 'ods_lis_result' }] },
    updatedAt: '2026-11-10T03:00:00Z',
    structured: { form: 'TABLE', sourceId: 'src-lis-001', catalog: 'lis_db', tables: ['lab_result'], columns: ['result_id', 'patient_key', 'update_time'], orderKey: 'update_time', mode: 'INCREMENTAL', sinkFenodes: 'doris-fe:8030', sinkCredentialRef: 'cred-doris-writer' },
    lastSuccessWatermark: '2026-11-16T01:12:00Z',
  },
  'job-outpatient-visit-002': {
    jobId: 'job-outpatient-visit-002', templateKey: 'STRUCTURED_JDBC_TO_DORIS', templateVersion: 2,
    config: { source: [{ plugin_name: 'Jdbc' }], sink: [{ plugin_name: 'Doris' }] },
    updatedAt: '2026-11-12T03:00:00Z',
    structured: { form: 'SQL', sourceId: 'src-lis-001', catalog: 'his_db', mode: 'INCREMENTAL', customSql: "SELECT * FROM outpatient_visit WHERE update_time >= '${last_success_time}'", targetTable: 'src_outpatient_visit', sinkFenodes: 'doris-fe:8030', sinkCredentialRef: 'cred-doris-writer' },
    lastSuccessWatermark: '2026-11-16T02:10:00Z',
  },
  'job-ds-workflow-004': {
    jobId: 'job-ds-workflow-004', templateKey: 'CUSTOM', templateVersion: 1,
    config: { dolphinscheduler: { projectCode: 15187263948032, workflowDefinitionCode: 998811 } },
    updatedAt: '2026-11-08T03:00:00Z', structured: null, lastSuccessWatermark: null,
  },
}

const schedules = {
  'job-ds-workflow-004': {
    scheduleId: 771, crontab: '0 30 2 * * ?', startTime: null, endTime: null, timezoneId: 'Asia/Shanghai',
    online: true, warningType: 'ALL', nextFireTime: '2026-11-17T02:30:00Z', scheduled: true,
  },
}

const instances = {
  'job-ds-workflow-004': {
    total: 12,
    items: Array.from({ length: 10 }, (_, index) => ({
      id: 1000 + index,
      name: `药品目录平台调度同步-${10 - index}`,
      state: index === 0 ? 'RUNNING' : index === 1 ? 'FAILED' : 'SUCCEEDED',
      rawState: index === 0 ? 'RUNNING_EXECUTION' : index === 1 ? 'FAILURE' : 'SUCCESS',
      startTime: `2026-11-${String(16 - index).padStart(2, '0')}T02:30:00Z`,
      endTime: index === 0 ? null : `2026-11-${String(16 - index).padStart(2, '0')}T02:36:00Z`,
      runTimes: 1,
      host: 'worker-01:1234',
    })),
  },
}

const catalogs = { 'src-lis-001': ['lis_db', 'lis_dict'], 'src-emr-002': [], 'src-fhir-003': [] }
const tables = {
  'lis_db': [
    { name: 'lab_result', type: 'TABLE', remark: '检验结果明细' },
    { name: 'lab_item', type: 'TABLE', remark: '检验项目字典' },
    { name: 'specimen', type: 'TABLE', remark: '标本登记' },
  ],
  'lis_dict': [{ name: 'dept', type: 'TABLE', remark: '科室字典' }],
}
const columns = {
  'lis_db.lab_result': [
    { name: 'result_id', typeName: 'VARCHAR(64)', nullable: false, remark: '结果唯一标识' },
    { name: 'patient_key', typeName: 'VARCHAR(128)', nullable: false, remark: '患者主索引键' },
    { name: 'item_code', typeName: 'VARCHAR(32)', nullable: false, remark: '检验项目编码' },
    { name: 'result_value', typeName: 'VARCHAR(256)', nullable: true, remark: '结果值' },
    { name: 'update_time', typeName: 'TIMESTAMP', nullable: false, remark: '更新时间' },
  ],
  'lis_db.lab_item': [
    { name: 'item_code', typeName: 'VARCHAR(32)', nullable: false, remark: '项目编码' },
    { name: 'item_name', typeName: 'VARCHAR(128)', nullable: false, remark: '项目名称' },
  ],
  'lis_db.specimen': [
    { name: 'specimen_id', typeName: 'VARCHAR(64)', nullable: false, remark: '标本号' },
    { name: 'collected_at', typeName: 'TIMESTAMP', nullable: true, remark: '采集时间' },
  ],
  'lis_dict.dept': [
    { name: 'dept_code', typeName: 'VARCHAR(32)', nullable: false, remark: '科室编码' },
    { name: 'dept_name', typeName: 'VARCHAR(128)', nullable: false, remark: '科室名称' },
  ],
}

const templates = [
  { key: 'JDBC_TO_DORIS', version: 2, displayName: 'JDBC → Doris 批量同步', systemType: 'LIS', protocol: 'JDBC', executor: 'SEATUNNEL', mode: 'BATCH', description: '关系型库到仓湖的批量同步', requiredCredentialRoles: ['source', 'sink'], sampleConfig: { source: [{ plugin_name: 'Jdbc' }], sink: [{ plugin_name: 'Doris' }] } },
  { key: 'FHIR_PULL', version: 1, displayName: 'FHIR 拉取', systemType: 'HIS', protocol: 'FHIR', executor: 'SEATUNNEL', mode: 'BATCH', description: '区域交换网关 FHIR 接口拉取', requiredCredentialRoles: ['source'], sampleConfig: { source: [{ plugin_name: 'Http' }], sink: [{ plugin_name: 'Doris' }] } },
]

const workItems = [
  { type: 'run', title: '住院病历每日同步 · 执行失败', severity: 'CRITICAL', sourceType: 'run', sourceId: 'job-inpatient-record-003', deepLink: '/ingestion', asOf: '2026-11-15T18:02:00Z' },
  { type: 'issue', title: '药品编码不符合院级标准', severity: 'HIGH', sourceType: 'issue', sourceId: 'DQ-20261116-001', deepLink: '/governance', asOf: '2026-11-16T01:20:00Z' },
  { type: 'notification', title: '质量通知投递失败 2 封', severity: 'MEDIUM', sourceType: 'notification', sourceId: 'NOTI-001', deepLink: '/operations-center', asOf: '2026-11-16T00:40:00Z' },
  { type: 'mpiMetrics', title: '主索引候选待复核 6 对', severity: 'MEDIUM', sourceType: 'mpiMetrics', sourceId: 'MPI-001', deepLink: '/mpi', asOf: '2026-11-16T01:00:00Z' },
]

const events = [
  { domain: 'INGESTION', type: 'SUCCEEDED', detail: '检验报告结果采集完成（12,860 行）', asOf: '2026-11-16T01:12:00Z' },
  { domain: 'GOVERNANCE', type: 'PUBLISHED', detail: '质量问题 DQ-20261116-001 进入复检队列', asOf: '2026-11-16T01:20:00Z' },
  { domain: 'STANDARD', type: 'ACTIVATED', detail: '院级药品目录 v3 生效', asOf: '2026-11-15T09:00:00Z' },
  { domain: 'CONTRACT', type: 'FAILED', detail: '合同投递 webhook 返回 502，已进入重试', asOf: '2026-11-15T22:10:00Z' },
]

function json(response, status, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, Idempotency-Key',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  })
  response.end(body)
}

function readBody(request) {
  return new Promise((resolveBody) => {
    let raw = ''
    request.on('data', (chunk) => { raw += chunk })
    request.on('end', () => {
      try { resolveBody(raw ? JSON.parse(raw) : {}) } catch { resolveBody({}) }
    })
  })
}

function findJob(id) {
  return jobs.find((job) => job.id === id)
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)
  const path = url.pathname.replace(/^\/api/, '')
  const method = request.method ?? 'GET'

  if (method === 'OPTIONS') return json(response, 204, {})

  // 运行状态与运营投影
  if (path === '/v1/system/status') {
    return json(response, 200, {
      mode: 'LIVE', seedDemoEnabled: false, qualityExecutor: 'READY', qualityExecutorConfigured: true,
      demoQualityExecutorEnabled: false, seatunnelConfigured: true, notificationConfigured: true,
      operational: { state: 'READY', ready: 7, degraded: 0, unknown: 0, total: 7 }, warnings: [],
    })
  }
  if (path === '/v1/operations/summary') {
    return json(response, 200, {
      asOf: now(), workItemsOpen: workItems.length,
      components: { state: 'READY', ready: 7, degraded: 0, unknown: 0, total: 7 },
      domains: {
        ingestion: { failedRuns: 1, stalledRuns: 1 },
        governance: { openIssues: 8, slaOverdue: 2 },
        notifications: { backlog: 2 },
        contracts: { deliveryBacklog: 1 },
        mpi: { availability: 'UP', reviewPending: 6 },
        dataApi: { failedCalls24h: 0 },
        aiData: { activeBuilds: 1, failedBuilds24h: 0 },
      },
    })
  }
  if (path === '/v1/operations/work-items') return json(response, 200, { items: workItems })
  if (path === '/v1/operations/events') return json(response, 200, { items: events })

  // 数据源
  if (path === '/v1/sources' && method === 'GET') return json(response, 200, { items: sources, total: sources.length })
  if (path === '/v1/sources' && method === 'POST') {
    const body = await readBody(request)
    const created = {
      id: `src-${randomUUID().slice(0, 8)}`, tenantId: 'tenant-demo', institutionId: 'INST-001',
      name: String(body.name ?? '未命名来源'), systemType: String(body.systemType ?? 'LIS'), protocol: String(body.protocol ?? 'JDBC'),
      status: 'UNCHECKED', createdAt: now(), lastCheckedAt: null, lastCheckMessage: null, connection: null,
    }
    sources.unshift(created)
    return json(response, 201, created)
  }
  let match = /^\/v1\/sources\/([^/]+)\/check$/.exec(path)
  if (match && method === 'POST') {
    const source = sources.find((item) => item.id === match[1])
    if (!source) return json(response, 404, { message: '数据源不存在' })
    source.status = 'HEALTHY'
    source.lastCheckedAt = now()
    source.lastCheckMessage = '连接成功，只读账号可用'
    return json(response, 200, source)
  }
  match = /^\/v1\/sources\/([^/]+)\/connection$/.exec(path)
  if (match && method === 'PUT') {
    const source = sources.find((item) => item.id === match[1])
    if (!source) return json(response, 404, { message: '数据源不存在' })
    const body = await readBody(request)
    source.connection = body.config ?? {}
    return json(response, 200, source)
  }
  match = /^\/v1\/sources\/([^/]+)\/catalogs$/.exec(path)
  if (match) return json(response, 200, { catalogs: catalogs[match[1]] ?? [], truncated: false })
  match = /^\/v1\/sources\/([^/]+)\/tables$/.exec(path)
  if (match) return json(response, 200, { tables: tables[url.searchParams.get('catalog') ?? ''] ?? [], truncated: false })
  match = /^\/v1\/sources\/([^/]+)\/columns$/.exec(path)
  if (match) {
    const key = `${url.searchParams.get('catalog') ?? ''}.${url.searchParams.get('table') ?? ''}`
    return json(response, 200, { columns: columns[key] ?? [] })
  }
  match = /^\/v1\/sources\/([^/]+)\/query$/.exec(path)
  if (match && method === 'POST') {
    return json(response, 200, {
      columns: ['result_id', 'item_code', 'result_value', 'update_time'],
      rows: [['R-0001', 'ITEM-001', '4.21', '2026-11-16 01:10:00'], ['R-0002', 'ITEM-002', '12.0', '2026-11-16 01:11:00']],
      truncated: false,
    })
  }

  // 采集任务
  if (path === '/v1/jobs' && method === 'GET') return json(response, 200, { items: jobs, total: jobs.length })
  if (path === '/v1/jobs' && method === 'POST') {
    const body = await readBody(request)
    const source = sources.find((item) => item.id === body.sourceId)
    if (!source) return json(response, 400, { message: '数据源不存在' })
    const created = {
      id: `job-${randomUUID().slice(0, 8)}`, sourceId: source.id, name: String(body.name ?? '未命名任务'),
      mode: String(body.mode ?? 'BATCH'), executor: String(body.executor ?? 'SEATUNNEL'), status: 'DRAFT',
      createdAt: now(), latestRunStatus: null, lastRunAt: null, templateKey: body.templateKey || null,
      templateVersion: body.templateVersion ?? null, configured: Boolean(body.templateKey),
    }
    jobs.unshift(created)
    runs[created.id] = []
    return json(response, 201, created)
  }
  if (path === '/v1/workflow-templates') return json(response, 200, templates)
  match = /^\/v1\/jobs\/([^/]+)\/status$/.exec(path)
  if (match && method === 'PUT') {
    const job = findJob(match[1])
    if (!job) return json(response, 404, { message: '任务不存在' })
    const body = await readBody(request)
    job.status = String(body.status ?? job.status)
    return json(response, 200, job)
  }
  match = /^\/v1\/jobs\/([^/]+)\/config$/.exec(path)
  if (match && method === 'GET') {
    const config = configs[match[1]]
    if (!config) return json(response, 404, { message: '配置不存在' })
    return json(response, 200, config)
  }
  if (match && method === 'PUT') {
    const body = await readBody(request)
    const job = findJob(match[1])
    if (!job) return json(response, 404, { message: '任务不存在' })
    const saved = {
      jobId: job.id, templateKey: String(body.templateKey ?? 'CUSTOM'), templateVersion: Number(body.templateVersion ?? 1),
      config: body.structured ? (configs[job.id]?.config ?? {}) : (body.config ?? {}),
      updatedAt: now(), structured: body.structured ?? null, lastSuccessWatermark: configs[job.id]?.lastSuccessWatermark ?? null,
    }
    configs[job.id] = saved
    job.configured = true
    job.templateKey = saved.templateKey
    job.templateVersion = saved.templateVersion
    return json(response, 200, saved)
  }
  match = /^\/v1\/jobs\/([^/]+)\/copy$/.exec(path)
  if (match && method === 'POST') {
    const origin = findJob(match[1])
    if (!origin) return json(response, 404, { message: '任务不存在' })
    const body = await readBody(request)
    const copy = { ...origin, id: `job-${randomUUID().slice(0, 8)}`, name: String(body.name ?? `${origin.name}-副本`), status: 'DRAFT', latestRunStatus: null, lastRunAt: null, createdAt: now() }
    jobs.unshift(copy)
    runs[copy.id] = []
    return json(response, 201, copy)
  }
  match = /^\/v1\/jobs\/([^/]+)\/runs$/.exec(path)
  if (match && method === 'GET') {
    const list = runs[match[1]] ?? []
    return json(response, 200, { items: list, total: list.length })
  }
  if (match && method === 'POST') {
    const job = findJob(match[1])
    if (!job) return json(response, 404, { message: '任务不存在' })
    const run = { id: `run-${randomUUID().slice(0, 8)}`, jobId: job.id, status: 'SUBMITTED', executor: job.executor, externalId: null, message: '运行已提交，等待执行器回执', reconciliationStatus: null, reconciliationMessage: null, submittedAt: now(), startedAt: null, finishedAt: null }
    runs[job.id] = [run, ...(runs[job.id] ?? [])]
    job.latestRunStatus = run.status
    job.lastRunAt = run.submittedAt
    return json(response, 201, run)
  }
  match = /^\/v1\/jobs\/([^/]+)\/runs\/([^/]+)\/(sync|retry)$/.exec(path)
  if (match && method === 'POST') {
    const list = runs[match[1]] ?? []
    const run = list.find((item) => item.id === match[2])
    if (!run) return json(response, 404, { message: '运行不存在' })
    if (match[3] === 'sync') {
      run.status = 'SUCCEEDED'
      run.finishedAt = now()
      run.message = '采集完成（同步回写）'
      return json(response, 200, run)
    }
    const retried = { ...run, id: `run-${randomUUID().slice(0, 8)}`, status: 'SUBMITTED', submittedAt: now(), finishedAt: null, reconciliationStatus: null }
    runs[match[1]] = [retried, ...list]
    return json(response, 201, retried)
  }
  match = /^\/v1\/jobs\/([^/]+)\/runs\/([^/]+)\/reconcile\/confirm-absent$/.exec(path)
  if (match && method === 'POST') {
    const list = runs[match[1]] ?? []
    const run = list.find((item) => item.id === match[2])
    if (!run) return json(response, 404, { message: '运行不存在' })
    run.reconciliationStatus = 'CONFIRMED_ABSENT'
    run.message = '已确认外部运行不存在，允许重试'
    return json(response, 200, run)
  }

  // 周期调度
  match = /^\/v1\/jobs\/([^/]+)\/schedule$/.exec(path)
  if (match) {
    const job = findJob(match[1])
    if (!job) return json(response, 404, { message: '任务不存在' })
    if (method === 'GET') {
      return json(response, 200, schedules[job.id] ?? { scheduleId: null, crontab: null, startTime: null, endTime: null, timezoneId: 'Asia/Shanghai', online: false, warningType: null, nextFireTime: null, scheduled: false })
    }
    if (method === 'PUT') {
      const body = await readBody(request)
      schedules[job.id] = {
        scheduleId: schedules[job.id]?.scheduleId ?? Math.floor(Math.random() * 1000),
        crontab: String(body.crontab ?? ''), startTime: body.startTime ?? null, endTime: body.endTime ?? null,
        timezoneId: 'Asia/Shanghai', online: schedules[job.id]?.online ?? false, warningType: 'ALL',
        nextFireTime: '2026-11-17T02:30:00Z', scheduled: true,
      }
      return json(response, 200, schedules[job.id])
    }
    if (method === 'DELETE') {
      delete schedules[job.id]
      response.writeHead(204, { 'Access-Control-Allow-Origin': '*' })
      return response.end()
    }
  }
  match = /^\/v1\/jobs\/([^/]+)\/schedule\/(online|offline)$/.exec(path)
  if (match && method === 'POST') {
    const current = schedules[match[1]]
    if (!current) return json(response, 400, { message: '调度未配置' })
    current.online = match[2] === 'online'
    return json(response, 200, current)
  }
  match = /^\/v1\/jobs\/([^/]+)\/schedule\/preview$/.exec(path)
  if (match && method === 'POST') {
    return json(response, 200, { source: 'DS', fireTimes: ['2026-11-17T02:30:00Z', '2026-11-18T02:30:00Z', '2026-11-19T02:30:00Z'] })
  }
  match = /^\/v1\/jobs\/([^/]+)\/instances$/.exec(path)
  if (match && method === 'GET') {
    const payload = instances[match[1]] ?? { total: 0, items: [] }
    return json(response, 200, { items: payload.items, total: payload.total, page: Number(url.searchParams.get('page') ?? 1), size: Number(url.searchParams.get('size') ?? 10) })
  }
  match = /^\/v1\/jobs\/([^/]+)\/instances\/(\d+)\/tasks$/.exec(path)
  if (match) {
    return json(response, 200, [
      { id: 501, name: 'jdbc-reader', state: 'SUCCEEDED', rawState: 'SUCCESS', startTime: '2026-11-16T02:30:00Z', endTime: '2026-11-16T02:33:00Z' },
      { id: 502, name: 'doris-writer', state: 'RUNNING', rawState: 'RUNNING_EXECUTION', startTime: '2026-11-16T02:33:00Z', endTime: null },
    ])
  }
  match = /^\/v1\/jobs\/([^/]+)\/instances\/(\d+)\/tasks\/(\d+)\/log$/.exec(path)
  if (match) {
    return json(response, 200, { lines: 4, logText: '[INFO] reader started\n[INFO] fetched 12860 rows\n[INFO] writer started\n[WARN] retry sink batch 2' })
  }
  match = /^\/v1\/jobs\/([^/]+)\/instances\/(\d+)\/(stop|retry)$/.exec(path)
  if (match && method === 'POST') {
    response.writeHead(204, { 'Access-Control-Allow-Origin': '*' })
    return response.end()
  }
  match = /^\/v1\/jobs\/([^/]+)\/instances\/backfill$/.exec(path)
  if (match && method === 'POST') {
    response.writeHead(204, { 'Access-Control-Allow-Origin': '*' })
    return response.end()
  }

  return json(response, 404, { message: `未实现的控制面替身端点：${method} ${path}` })
})

server.listen(port, '127.0.0.1', () => {
  console.log(`mock control plane listening on http://127.0.0.1:${port}/api`)
})
