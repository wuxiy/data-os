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

// —— 治理闭环（FE3）：问题 / 规则 / 评分 / 标准 / 映射 ——
const govIssues = [
  { id: 'DQ-20261116-001', title: '药品编码不符合院级标准', severity: 'HIGH', status: 'IN_PROGRESS', datasetId: 'ods_ep.ep_order', ruleId: 'quality.ep.order.paystatus-range', ownerDepartment: '药学部', ownerName: '王药师', ticketId: 'TICKET-001', impact: '门诊医疗 / 38 张表', dueAt: '2026-11-15T09:00:00Z', objectLabel: '门诊处方明细', processingNote: '已核对 127 个编码，待药学部确认替换口径。', updatedAt: '2026-11-16T01:20:00Z' },
  { id: 'DQ-20261116-002', title: '患者证件号完整性校验未通过', severity: 'CRITICAL', status: 'RECHECKING', datasetId: 'mpi_source_identity', ruleId: 'quality.mpi.identity.missing', ownerDepartment: '病案管理科', ownerName: '李老师', ticketId: '', impact: '患者主索引 / 12 张表', dueAt: '2026-11-14T09:00:00Z', objectLabel: '患者源身份', processingNote: null, updatedAt: '2026-11-16T02:00:00Z' },
  { id: 'DQ-20261110-003', title: '就诊类型枚举值不规范', severity: 'LOW', status: 'CLOSED', datasetId: 'ods_outpatient_visit', ruleId: 'quality.visit.type.enum', ownerDepartment: '信息中心', ownerName: '陈老师', ticketId: 'TICKET-000', impact: '门诊医疗 / 6 张表', dueAt: '2026-11-10T09:00:00Z', objectLabel: '门诊就诊记录', processingNote: '字典已补齐，复检通过。', updatedAt: '2026-11-10T10:00:00Z' },
]

function govDetail(issue) {
  const run = issue.status === 'RECHECKING'
    ? { id: 'qr-1001', issueId: issue.id, tenantId: 't', institutionId: 'i', ruleId: issue.ruleId, datasetId: issue.datasetId, executor: 'DBT', status: 'SUBMITTED', externalId: null, executionBatchId: 'batch-20261116-0001', passed: null, resultMessage: '等待执行器回写结果', sampleEvidence: [{ id: 'DEMO-018', count: 86 }], artifactUri: 'https://artifacts.internal/recheck/1001.json', reconciliationStatus: null, reconciliationMessage: null, submittedAt: '2026-11-16T02:00:00Z', startedAt: null, finishedAt: '2026-11-16T02:01:00Z', attemptCount: 1, nextPollAt: new Date(Date.now() + 3000).toISOString(), lastError: null, updatedAt: '2026-11-16T02:00:00Z' }
    : null
  return {
    issue,
    events: [
      { id: 'e1', issueId: issue.id, eventType: 'RECHECK_SUBMIT_FAILED', note: '执行器不可用，按策略重试', actor: 'system', createdAt: '2026-11-16T01:55:00Z' },
      { id: 'e2', issueId: issue.id, eventType: 'RECHECK_SUBMIT_FAILED', note: '执行器不可用，按策略重试', actor: 'system', createdAt: '2026-11-16T01:57:00Z' },
      { id: 'e3', issueId: issue.id, eventType: 'WORKFLOW_UPDATED', note: `已分派给${issue.ownerDepartment}`, actor: 'governance-admin', createdAt: '2026-11-16T01:26:00Z' },
      { id: 'e4', issueId: issue.id, eventType: 'RECHECK_REQUESTED', note: `规则 ${issue.ruleId} 发现质量问题`, actor: 'quality-runner', createdAt: '2026-11-16T01:20:00Z' },
    ],
    latestRun: run,
    runs: run ? [run, { ...run, id: 'qr-0999', executionBatchId: 'batch-20261115-0009', status: 'FAILED', submittedAt: '2026-11-15T02:00:00Z', nextPollAt: null }] : [],
    notifications: [{ id: 'n1', issueId: issue.id, eventId: null, channel: 'EMAIL', recipient: 'owner@hospital', subject: '质量问题待处理', body: '', status: 'SENT', idempotencyKey: 'k1', attemptCount: 1, lastError: null, nextAttemptAt: null, sentAt: '2026-11-16T01:30:00Z', createdAt: '2026-11-16T01:29:00Z', updatedAt: '2026-11-16T01:30:00Z' }],
  }
}

const govRules = [
  { ruleId: 'quality.ep.order.paystatus-range', ruleType: 'VAL_SET', datasetId: 'ods_ep.ep_order', targetColumn: 'PAY_STATUS', params: { values: [0, 1] }, evidenceColumns: [{ name: 'ORDER_ID', classification: 'IDENTIFIER' }], enabled: true, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-11-10T00:00:00Z' },
  { ruleId: 'quality.mpi.identity.missing', ruleType: 'NOT_NULL', datasetId: 'mpi_source_identity', targetColumn: 'IDENTITY_KEY', params: { checkBlank: true }, evidenceColumns: [], enabled: false, createdAt: '2026-10-02T00:00:00Z', updatedAt: '2026-11-11T00:00:00Z' },
]

const govRuleTypes = ['NOT_NULL', 'UNIQUE', 'VAL_SET', 'VAL_MINMAX', 'VAL_LEN', 'STR_REGEX', 'FK_REF', 'SQL', 'CROSS_VAL_COMPARE', 'STAT_VAL_COMPARE', 'SQL_STAT_VAL', 'DETAIL_STAT', 'FIELD_LOGIC', 'UPDATE_TIME', 'TIME_CONTINUITY']
  .map((type) => ({ type, label: { NOT_NULL: '非空校验', UNIQUE: '唯一性校验', VAL_SET: '值域校验', VAL_MINMAX: '数值范围校验', VAL_LEN: '长度范围校验', STR_REGEX: '正则校验', FK_REF: '外键参照校验', SQL: '自定义 SQL 校验', CROSS_VAL_COMPARE: '跨表数据值比较', STAT_VAL_COMPARE: '统计数据值比较', SQL_STAT_VAL: 'SQL 统计值比较', DETAIL_STAT: '明细汇总校验', FIELD_LOGIC: '字段间关系', UPDATE_TIME: '更新时效校验', TIME_CONTINUITY: '时间连续性校验' }[type], dimension: '一致性', computedEvidence: ['STAT_VAL_COMPARE', 'SQL_STAT_VAL', 'DETAIL_STAT', 'TIME_CONTINUITY'].includes(type) }))

const govScore = {
  standard: { passScore: 60, weights: { 完整性: 1, 一致性: 1, 规范性: 1, 准确性: 1, 时效性: 1, 稳定性: 1 }, grades: [{ grade: 'A', lowScore: 90 }, { grade: 'B', lowScore: 75 }, { grade: 'C', lowScore: 60 }], updatedAt: '2026-11-01T00:00:00Z' },
  dimensions: [
    { dimension: '完整性', score: 96.2, ruleCount: 4 }, { dimension: '一致性', score: 88.4, ruleCount: 6 },
    { dimension: '规范性', score: 92.1, ruleCount: 3 }, { dimension: '准确性', score: 97.5, ruleCount: 5 },
    { dimension: '时效性', score: 85.0, ruleCount: 2 }, { dimension: '稳定性', score: 99.0, ruleCount: 1 },
  ],
  totalScore: 93.0,
  grade: 'A',
  rules: [
    { ruleId: 'quality.ep.order.paystatus-range', ruleType: 'VAL_SET', targetColumn: 'PAY_STATUS', datasetId: 'ods_ep.ep_order', score: 96.2, passed: true },
    { ruleId: 'quality.mpi.identity.missing', ruleType: 'NOT_NULL', targetColumn: 'IDENTITY_KEY', datasetId: 'mpi_source_identity', score: null, passed: null },
  ],
}

const govStandards = [
  { id: 'std-001', code: 'reg-channel', name: '挂号渠道标准', description: '渠道枚举与业务定义', owner: '信息中心', updatedAt: '2026-11-12T00:00:00Z', versionCount: 2, latestVersion: { versionNo: 2, status: 'PUBLISHED', syncStatus: 'SYNCED' } },
  { id: 'std-002', code: 'drug-code', name: '院级药品编码', description: '药品编码与名称标准', owner: '药学部', updatedAt: '2026-11-14T00:00:00Z', versionCount: 1, latestVersion: { versionNo: 1, status: 'DRAFT', syncStatus: 'PENDING' } },
]

function standardDetail(id, versionId) {
  const item = govStandards.find((standard) => standard.id === id) ?? govStandards[0]
  const versions = [
    { id: `${id}-v2`, versionNo: 2, status: item.latestVersion.status, syncStatus: item.latestVersion.syncStatus, createdBy: 'data-governance', createdAt: '2026-11-12T00:00:00Z', publishedAt: '2026-11-12T06:00:00Z' },
    { id: `${id}-v1`, versionNo: 1, status: 'DEPRECATED', syncStatus: 'SYNCED', createdBy: 'data-governance', createdAt: '2026-10-12T00:00:00Z', deprecatedAt: '2026-11-12T06:00:00Z' },
  ]
  const version = versions.find((entry) => entry.id === versionId) ?? versions[0]
  return {
    standard: { id: item.id, code: item.code, name: item.name, description: item.description, owner: item.owner, updatedAt: item.updatedAt },
    versions,
    version: {
      id: version.id, versionNo: version.versionNo, status: version.status, syncStatus: version.syncStatus,
      elements: [
        { id: `${version.id}-e1`, code: 'channel', name: '挂号渠道', dataType: 'CODE', required: true, definition: '渠道枚举', sensitivity: 'NORMAL', assetRef: '', values: [{ code: 'OPD', displayName: '门诊', validFrom: '2026-01-01', validTo: '9999-12-31' }, { code: 'IPD', displayName: '住院', validFrom: '2026-01-01', validTo: '9999-12-31' }] },
        { id: `${version.id}-e2`, code: 'patient_id', name: '患者标识', dataType: 'STRING', required: true, definition: '院内患者主索引键', sensitivity: 'SENSITIVE', assetRef: 'doris.dataos.mpi.mpi_golden_person', values: [] },
      ],
    },
    events: [
      { id: 'se1', eventType: 'PUBLISHED', actor: 'governance-admin', detail: 'OM 术语投影已同步', createdAt: '2026-11-12T06:00:00Z' },
      { id: 'se2', eventType: 'SUBMITTED', actor: 'data-governance', detail: '提交评审', createdAt: '2026-11-12T05:00:00Z' },
    ],
  }
}

const govMappings = [
  { id: 'map-001', code: 'MAP-EP-CFZB', name: '门诊处方表映射', sourceAsset: 'doris.dataos.ods_ep.ep_order', dataset: 'ods_ep.ep_order', standard: { id: 'std-001', code: 'reg-channel', name: '挂号渠道标准' }, versionCount: 2, activeVersion: { versionNo: 1, status: 'ACTIVE', checksum: 'abc123def456' }, updatedAt: '2026-11-13T00:00:00Z' },
]

function mappingDetail(id, versionId) {
  const set = govMappings.find((item) => item.id === id) ?? govMappings[0]
  const versions = [
    { id: `${id}-v2`, versionNo: 2, status: 'DRAFT', checksum: 'def456789abc', createdAt: '2026-11-13T00:00:00Z' },
    { id: `${id}-v1`, versionNo: 1, status: 'ACTIVE', checksum: 'abc123def456', createdAt: '2026-11-01T00:00:00Z' },
    { id: `${id}-v0`, versionNo: 0, status: 'RETIRED', checksum: 'aaa111bbb222', createdAt: '2026-10-01T00:00:00Z' },
  ]
  const version = versions.find((entry) => entry.id === versionId) ?? versions[0]
  return {
    set,
    versions,
    version: {
      ...version,
      items: [
        { id: 'mi1', sourceColumn: 'CHANNEL_CODE', targetElementCode: 'channel', transform: 'VALUE_MAP', transformParam: '{"OPD":"OPD","IPD":"IPD"}', conclusion: 'CONFIRMED', note: '' },
        { id: 'mi2', sourceColumn: 'PATIENT_NO', targetElementCode: 'patient_id', transform: 'COPY', transformParam: '', conclusion: 'PENDING', note: '' },
      ],
      validations: [{ id: 'mv1', status: 'PASS', checksum: version.checksum, dataTime: '2026-11-13T01:00:00Z', createdAt: '2026-11-13T01:00:00Z', result: '全部通过' }],
    },
    events: [
      { id: 'me1', eventType: 'VALIDATED', actor: 'data-governance', detail: '聚合验证 PASS', createdAt: '2026-11-13T01:00:00Z' },
    ],
  }
}


// —— 资产与 MPI（FE4）——
const lineageSchemaAssets = {
  ods_ep: [
    { name: 'ep_mz_cfzb', fullyQualifiedName: 'doris-dataos.ods_ep.ep_mz_cfzb', displayName: '门诊处方主表', columnCount: 12, updatedAt: '2026-11-16T01:00:00Z', updatedBy: 'ingest' },
    { name: 'ep_mz_cfzb_detail', fullyQualifiedName: 'doris-dataos.ods_ep.ep_mz_cfzb_detail', displayName: '门诊处方明细', columnCount: 18, updatedAt: '2026-11-16T01:00:00Z', updatedBy: 'ingest' },
    { name: 'ep_patient', fullyQualifiedName: 'doris-dataos.ods_ep.ep_patient', displayName: '门诊患者', columnCount: 9, updatedAt: '2026-11-16T01:00:00Z', updatedBy: 'ingest' },
  ],
  dataos_mpi: [
    { name: 'mpi_golden_person', fullyQualifiedName: 'doris-dataos.dataos_mpi.mpi_golden_person', displayName: '黄金人索引', columnCount: 7, updatedAt: '2026-11-16T01:00:00Z', updatedBy: 'ingest' },
  ],
}

function assetDetail(fqn) {
  const name = fqn.split('.').pop()
  return {
    name, fullyQualifiedName: fqn, displayName: name === 'ep_mz_cfzb' ? '门诊处方主表' : name,
    description: '门诊处方结构元数据；业务定义在资产治理流程中补充。',
    columns: [
      { name: 'PRESCRIPTION_ID', dataType: 'VARCHAR(64)', description: '处方唯一标识' },
      { name: 'PATIENT_ID', dataType: 'VARCHAR(64)', description: '患者主索引键' },
      { name: 'PAY_STATUS', dataType: 'INT', description: '支付状态' },
      { name: 'AMOUNT', dataType: 'DECIMAL(12,2)', description: '处方金额' },
      { name: 'UPDATE_TIME', dataType: 'TIMESTAMP', description: '更新时间' },
    ],
    updatedAt: '2026-11-16T01:00:00Z',
  }
}

function assetLineage(fqn) {
  return {
    root: fqn,
    upstreams: [{ fullyQualifiedName: 'doris-dataos.ods_ep.ep_mz_visit', type: 'table', displayName: '门诊就诊记录', columnMappings: [{ fromColumns: ['VISIT_ID'], toColumn: 'VISIT_ID' }] }],
    downstreams: [
      { fullyQualifiedName: 'doris-dataos.dws.dws_prescription_day', type: 'table', displayName: '处方日汇总', columnMappings: [{ fromColumns: ['AMOUNT'], toColumn: 'TOTAL_AMOUNT' }] },
      { fullyQualifiedName: 'superset-dataos.model.2', type: 'dataModel', displayName: '处方运营模型', columnMappings: [] },
    ],
  }
}

const mpiCandidates = [
  {
    taskId: 'task-001', pairId: 1, status: 'OPEN', createdAt: '2026-11-16T00:00:00Z', ruleId: 'E5', outcome: 'REVIEW',
    identityA: { identity: 'H|EP|1', institution: 'ctest', sourceSystem: 'EP', patientId: '1***1', cardNo: '120112****6978', name: '陈测一短信一23', gender: 'F', age: '59.0' },
    identityB: { identity: 'H|EP|2', institution: 'ctest', sourceSystem: 'EP', patientId: '2***2', cardNo: '120112****6979', name: '陈测一104', gender: 'F', age: '59.0' },
    evidence: JSON.stringify([{ field: 'name', valueA: '陈测一短信一23', valueB: '陈测一104', match: false }, { field: 'cardNo', valueA: '120112****6978', valueB: '120112****6979', match: false }]),
  },
  {
    taskId: 'task-002', pairId: 2, status: 'OPEN', createdAt: '2026-11-16T00:30:00Z', ruleId: 'E2', outcome: 'REVIEW',
    identityA: { identity: 'H|EP|3', institution: 'ctest', sourceSystem: 'EP', patientId: '3***3', cardNo: '', name: '张测三', gender: 'M', age: '41.0' },
    identityB: { identity: 'H|EP|4', institution: 'ctest', sourceSystem: 'EP', patientId: '4***4', cardNo: '', name: '张测三', gender: 'M', age: '41.0' },
    evidence: JSON.stringify([{ field: 'name', valueA: '张测三', valueB: '张测三', match: true }]),
  },
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


  // —— 治理闭环（FE3）——
  if (path === '/v1/governance/summary') {
    return json(response, 200, {
      asOf: now(), tenantId: 'tenant-demo', institutionId: 'INST-001',
      metrics: [
        { key: 'standard-coverage', label: '标准覆盖率', value: 82.5, unit: '%', target: 90, detail: '已发布标准覆盖的资产比例', tone: 'warning' },
        { key: 'quality-pass', label: '质量规则通过率', value: 98.4, unit: '%', target: 95, detail: '最近一轮规则运行', tone: 'healthy' },
        { key: 'issue-closure', label: '问题按时闭环率', value: 91.0, unit: '%', target: 90, detail: 'SLA 内关闭占比', tone: 'healthy' },
        { key: 'lineage', label: '血缘完整率', value: 76.0, unit: '%', target: 85, detail: '上下游已登记资产', tone: 'warning' },
      ],
      issues: govIssues,
    })
  }
  if (path === '/v1/governance/issues' && method === 'GET') {
    const status = url.searchParams.get('status')
    const query = (url.searchParams.get('query') ?? '').toLowerCase()
    const items = govIssues.filter((issue) => (!status || issue.status === status)
      && (!query || `${issue.id}${issue.title}${issue.ownerDepartment}`.toLowerCase().includes(query)))
    return json(response, 200, { items, total: items.length })
  }
  match = /^\/v1\/governance\/issues\/([^/]+)$/.exec(path)
  if (match && method === 'GET') {
    const issue = govIssues.find((item) => item.id === match[1])
    if (!issue) return json(response, 404, { message: '问题不存在' })
    return json(response, 200, govDetail(issue))
  }
  match = /^\/v1\/governance\/issues\/([^/]+)\/workflow$/.exec(path)
  if (match && method === 'PUT') {
    const issue = govIssues.find((item) => item.id === match[1])
    if (!issue) return json(response, 404, { message: '问题不存在' })
    const body = await readBody(request)
    issue.status = String(body.status ?? issue.status)
    issue.processingNote = String(body.note ?? '')
    issue.updatedAt = now()
    return json(response, 200, govDetail(issue))
  }
  match = /^\/v1\/governance\/issues\/([^/]+)\/recheck$/.exec(path)
  if (match && method === 'POST') {
    const issue = govIssues.find((item) => item.id === match[1])
    if (!issue) return json(response, 404, { message: '问题不存在' })
    issue.status = 'RECHECKING'
    issue.updatedAt = now()
    return json(response, 200, govDetail(issue))
  }
  match = /^\/v1\/governance\/issues\/([^/]+)\/runs\/([^/]+)\/sync$/.exec(path)
  if (match && method === 'POST') {
    const issue = govIssues.find((item) => item.id === match[1])
    if (!issue) return json(response, 404, { message: '问题不存在' })
    const detail = govDetail(issue)
    if (detail.latestRun) {
      detail.latestRun.status = 'SUCCEEDED'
      detail.latestRun.passed = true
      detail.latestRun.resultMessage = '复检通过，0 条失败行'
      detail.latestRun.nextPollAt = null
      detail.latestRun.finishedAt = now()
      issue.status = 'CLOSED'
    }
    return json(response, 200, detail)
  }
  match = /^\/v1\/governance\/issues\/([^/]+)\/runs\/([^/]+)\/reconcile$/.exec(path)
  if (match && method === 'POST') {
    const issue = govIssues.find((item) => item.id === match[1])
    if (!issue) return json(response, 404, { message: '问题不存在' })
    return json(response, 200, govDetail(issue))
  }
  match = /^\/v1\/governance\/issues\/([^/]+)\/runs\/([^/]+)\/reconcile\/confirm-absent$/.exec(path)
  if (match && method === 'POST') {
    const issue = govIssues.find((item) => item.id === match[1])
    if (!issue) return json(response, 404, { message: '问题不存在' })
    return json(response, 200, govDetail(issue))
  }
  match = /^\/v1\/governance\/issues\/([^/]+)\/notifications\/remind$/.exec(path)
  if (match && method === 'POST') {
    const issue = govIssues.find((item) => item.id === match[1])
    if (!issue) return json(response, 404, { message: '问题不存在' })
    return json(response, 200, govDetail(issue))
  }

  if (path === '/v1/quality/rules/types') return json(response, 200, govRuleTypes)
  if (path === '/v1/quality/rules' && method === 'GET') return json(response, 200, { items: govRules, total: govRules.length })
  match = /^\/v1\/quality\/rules\/([^/]+)$/.exec(path)
  if (match && method === 'PUT') {
    const body = await readBody(request)
    const existing = govRules.find((rule) => rule.ruleId === match[1])
    const next = {
      ruleId: match[1], ruleType: body.ruleType, datasetId: body.datasetId, targetColumn: body.targetColumn,
      params: body.params ?? {}, evidenceColumns: body.evidenceColumns ?? [], enabled: existing?.enabled ?? true,
      createdAt: existing?.createdAt ?? now(), updatedAt: now(),
    }
    if (existing) Object.assign(existing, next)
    else govRules.unshift(next)
    return json(response, 200, next)
  }
  if (match && method === 'DELETE') {
    const index = govRules.findIndex((rule) => rule.ruleId === match[1])
    if (index >= 0) govRules.splice(index, 1)
    response.writeHead(204, { 'Access-Control-Allow-Origin': '*' })
    return response.end()
  }
  match = /^\/v1\/quality\/rules\/([^/]+)\/(enable|disable)$/.exec(path)
  if (match && method === 'POST') {
    const rule = govRules.find((item) => item.ruleId === match[1])
    if (!rule) return json(response, 404, { message: '规则不存在' })
    rule.enabled = match[2] === 'enable'
    return json(response, 200, rule)
  }
  if (path === '/v1/quality/score' && method === 'GET') return json(response, 200, govScore)
  if (path === '/v1/quality/score/standard' && method === 'PUT') {
    const body = await readBody(request)
    govScore.standard = { ...govScore.standard, ...body, updatedAt: now() }
    return json(response, 200, govScore.standard)
  }

  if (path === '/v1/data-standards' && method === 'GET') {
    const query = (url.searchParams.get('query') ?? '').toLowerCase()
    const status = url.searchParams.get('status') ?? ''
    const items = govStandards.filter((item) => (!query || `${item.code}${item.name}`.toLowerCase().includes(query))
      && (!status || item.latestVersion.status === status))
    return json(response, 200, { items })
  }
  match = /^\/v1\/data-standards\/([^/]+)$/.exec(path)
  if (match && method === 'GET') return json(response, 200, standardDetail(match[1], url.searchParams.get('versionId') ?? ''))
  match = /^\/v1\/data-standards\/([^/]+)\/versions$/.exec(path)
  if (match && method === 'POST') {
    const next = standardDetail(match[1])
    next.version = { ...next.version, id: `${match[1]}-v3`, versionNo: 3, status: 'DRAFT', syncStatus: 'PENDING' }
    return json(response, 200, next)
  }
  match = /^\/v1\/data-standard-versions\/([^/]+)$/.exec(path)
  if (match && method === 'PUT') return json(response, 200, standardDetail('std-001', match[1]))
  match = /^\/v1\/data-standard-versions\/([^/]+)\/(submit|publish|deprecate|sync)$/.exec(path)
  if (match && method === 'POST') return json(response, 200, standardDetail('std-001', match[1]))
  if (path === '/v1/data-standards/import') {
    const dryRun = url.searchParams.get('dryRun') === 'true'
    return json(response, 200, {
      dryRun, standardCode: 'reg-channel', elementCount: 2, valueCount: 3, problems: [],
      ...(dryRun ? {} : { created: standardDetail('std-001') }),
    })
  }
  match = /^\/v1\/data-standard-versions\/([^/]+)\/impact$/.exec(path)
  if (match) return json(response, 200, { versionId: match[1], versionNo: 2, status: 'PUBLISHED', elementCount: 2, referencedAssets: ['doris.dataos.ods_ep.ep_order'], notes: ['变更需同步下游映射'] })
  match = /^\/v1\/data-standard-versions\/([^/]+)\/fhir-bundle$/.exec(path)
  if (match) return json(response, 200, { resourceType: 'Bundle', type: 'collection', entry: [] })

  if (path === '/v1/standard-mappings' && method === 'GET') return json(response, 200, { items: govMappings })
  if (path === '/v1/standard-mappings/coverage') {
    return json(response, 200, { asOf: now(), activeMappingVersions: 1, publishedCodeElements: 24, coveredCodeElements: 21, coverage: 0.875 })
  }
  if (path === '/v1/standard-mappings' && method === 'POST') {
    const body = await readBody(request)
    return json(response, 200, mappingDetail(`map-${randomUUID().slice(0, 6)}`, ''))
  }
  match = /^\/v1\/standard-mappings\/([^/]+)$/.exec(path)
  if (match && method === 'GET') return json(response, 200, mappingDetail(match[1], url.searchParams.get('versionId') ?? ''))
  match = /^\/v1\/standard-mappings\/([^/]+)\/versions$/.exec(path)
  if (match && method === 'POST') return json(response, 200, mappingDetail(match[1]))
  match = /^\/v1\/standard-mapping-versions\/([^/]+)$/.exec(path)
  if (match && (method === 'PUT')) return json(response, 200, mappingDetail('map-001', match[1]))
  match = /^\/v1\/standard-mapping-versions\/([^/]+)\/import$/.exec(path)
  if (match) {
    const dryRun = url.searchParams.get('dryRun') === 'true'
    return json(response, 200, { dryRun, itemCount: 2, problems: [], checksum: 'def456789abc', applied: !dryRun })
  }
  match = /^\/v1\/standard-mapping-versions\/([^/]+)\/(submit|validate|activate|retire)$/.exec(path)
  if (match && method === 'POST') return json(response, 200, mappingDetail('map-001', match[1]))
  match = /^\/v1\/standard-mapping-versions\/([^/]+)\/impact$/.exec(path)
  if (match) return json(response, 200, { versionId: match[1], versionNo: 2, status: 'DRAFT', sourceAsset: 'doris.dataos.ods_ep.ep_order', dataset: 'ods_ep.ep_order', standard: { id: 'std-001', code: 'reg-channel', name: '挂号渠道标准' }, itemCount: 2, mappedElements: { channel: 1, patient_id: 1 }, unpublishedUncoveredElements: ['order_status'], latestValidation: {} })
  match = /^\/v1\/standard-mappings\/([^/]+)\/rollback$/.exec(path)
  if (match && method === 'POST') return json(response, 200, mappingDetail(match[1]))


  // —— 资产与 MPI（FE4）——
  if (path === '/v1/lineage/summary') {
    return json(response, 200, {
      service: 'doris-dataos', schemas: ['ods_ep', 'dataos_mpi'], tableCount: 4, columnCount: 46,
      dashboardService: 'superset-dataos', dashboards: [{ fullyQualifiedName: 'superset-dataos.model.2', displayName: '处方运营模型', updatedAt: '2026-11-16T00:00:00Z' }],
    })
  }
  if (path === '/v1/assets' && method === 'GET') {
    const schema = url.searchParams.get('schema') ?? 'ods_ep'
    return json(response, 200, { service: 'doris-dataos', schema, assets: lineageSchemaAssets[schema] ?? [], fetchedAt: now() })
  }
  match = /^\/v1\/assets\/([^/]+)\/lineage$/.exec(path)
  if (match) return json(response, 200, assetLineage(decodeURIComponent(match[1])))
  match = /^\/v1\/assets\/([^/]+)\/quality-tests$/.exec(path)
  if (match) {
    return json(response, 200, { tests: [
      { ruleId: 'quality.ep.order.paystatus-range', datasetId: 'ods_ep.ep_order', selector: 'PAY_STATUS', lastRun: { status: 'SUCCEEDED', passed: true, finishedAt: '2026-11-16T01:00:00Z' } },
      { ruleId: 'quality.ep.order.amount-min', datasetId: 'ods_ep.ep_order', selector: 'AMOUNT', lastRun: { status: 'FAILED', passed: false, finishedAt: '2026-11-16T02:00:00Z' } },
    ] })
  }
  match = /^\/v1\/assets\/([^/]+)$/.exec(path)
  if (match && method === 'GET') return json(response, 200, assetDetail(decodeURIComponent(match[1])))

  if (path === '/v1/mpi/metrics') {
    return json(response, 200, { identitiesLoaded: 2882, goldenPersons: 352, autoMatches: 360, reviewPending: mpiCandidates.length, reviewResolved: 4 })
  }
  if (path === '/v1/mpi/candidates') {
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase()
    const items = q
      ? mpiCandidates.filter((item) => `${item.identityA.name}${item.identityB.name}${item.identityA.cardNo}${item.ruleId}`.toLowerCase().includes(q))
      : mpiCandidates
    return json(response, 200, { total: items.length, page: 1, size: 100, items })
  }
  match = /^\/v1\/mpi\/persons\/([^/]+)$/.exec(path)
  if (match && method === 'GET') {
    return json(response, 200, {
      id: decodeURIComponent(match[1]), goldenName: '陈测一', goldenGender: 'F', status: 'ACTIVE', createdAt: '2026-11-01T00:00:00Z',
      links: [
        { sourceIdentifier: 'H|EP|1', decisionSource: 'MANUAL', linkStatus: 'ACTIVE' },
        { sourceIdentifier: 'H|EP|2', decisionSource: 'RULE', linkStatus: 'ACTIVE' },
      ],
      history: [{ action: 'MERGE', actor: 'mpi-worker', createdAt: '2026-11-16T00:00:00Z' }],
    })
  }
  match = /^\/v1\/mpi\/persons\/([^/]+)\/split$/.exec(path)
  if (match && method === 'POST') return json(response, 200, { personId: decodeURIComponent(match[1]), newPersonId: 'person-new', splitIdentity: 'H|EP|2' })
  if (path === '/v1/mpi/rebuild' && method === 'POST') {
    return json(response, 200, { identitiesLoaded: 2882, candidatePairs: 1128, outcomes: { autoMatch: 360, review: 768 } })
  }
  match = /^\/v1\/mpi\/links\/([^/]+)\/decision$/.exec(path)
  if (match && method === 'POST') {
    const body = await readBody(request)
    return json(response, 200, { taskId: decodeURIComponent(match[1]), resolution: body.resolution ?? 'SAME_PERSON', mergedPersonId: 'person-001' })
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
