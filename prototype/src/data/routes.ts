/**
 * 门户路由表：生产路由配置，与演示数据无关（曾误居 mock.ts）。
 * 17 个既有入口的键与 pathname 不重命名；10 个新增工作页以模板登记，
 * 由 builder 生成真实深链，避免页面里手拼字符串。
 */
export const routePaths = {
  management: '/',
  ingestion: '/ingestion',
  governance: '/governance',
  standards: '/governance/standards',
  mapping: '/governance/mapping',
  quality: '/governance/quality',
  mpi: '/mpi/review',
  assets: '/assets',
  assetTechnical: '/assets/technical',
  analytics: '/analysis',
  aiData: '/ai-data',
  dataServices: '/data-services',
  assistant: '/assistant',
  assistantWorkspace: '/assistant/workspace',
  operationsCenter: '/operations-center',
  deliveryCenter: '/delivery-center',
  operations: '/operations',
} as const

/** 新增工作页模式（FE2–FE5）：既有操作的容器迁移，不新增后端合同。 */
export const workPaths = {
  ingestionNew: '/ingestion/new',
  ingestionSourceExplorer: '/ingestion/sources/$sourceId/explorer',
  ingestionJob: '/ingestion/jobs/$jobId',
  qualityRuleNew: '/governance/quality/rules/new',
  qualityRuleEdit: '/governance/quality/rules/$ruleId/edit',
  qualityScoring: '/governance/quality/scoring',
  dataServiceNew: '/data-services/new',
  assistantQuestionNew: '/assistant/workspace/questions/new',
  assistantQuestion: '/assistant/workspace/questions/$questionCode',
  assistantAudit: '/assistant/workspace/audit',
} as const

const encode = (value: string) => encodeURIComponent(value)

export const workLinks = {
  ingestionNew: () => workPaths.ingestionNew,
  ingestionSourceExplorer: (sourceId: string) => `/ingestion/sources/${encode(sourceId)}/explorer`,
  ingestionJob: (jobId: string, tab?: 'overview' | 'configuration' | 'scheduling' | 'runs') =>
    `/ingestion/jobs/${encode(jobId)}${tab ? `?tab=${tab}` : ''}`,
  qualityRuleNew: () => workPaths.qualityRuleNew,
  qualityRuleEdit: (ruleId: string) => `/governance/quality/rules/${encode(ruleId)}/edit`,
  qualityScoring: () => workPaths.qualityScoring,
  dataServiceNew: () => workPaths.dataServiceNew,
  assistantQuestionNew: () => workPaths.assistantQuestionNew,
  assistantQuestion: (questionCode: string, tab?: 'definition' | 'try' | 'events') =>
    `/assistant/workspace/questions/${encode(questionCode)}${tab ? `?tab=${tab}` : ''}`,
  assistantAudit: () => workPaths.assistantAudit,
}

/** 既有深链的构造器（真实对象参数，`scenario` 只用于演示场景）。 */
export const deepLinks = {
  qualityIssue: (issueId: string) => `/governance/quality?issue=${encode(issueId)}`,
  mpiTask: (taskId: string) => `/mpi/review?task=${encode(taskId)}`,
  aiProduct: (productId: string) => `/ai-data?product=${encode(productId)}`,
  asset: (assetId: string) => `/assets?asset=${encode(assetId)}`,
  assetInDatabase: (db: string) => `/assets?db=${encode(db)}`,
  technicalAsset: (fqn: string) => `/assets/technical?asset=${encode(fqn)}`,
}
