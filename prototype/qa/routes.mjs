/**
 * 浏览器验收共用的路由清单：17 个既有入口 + 10 个新工作页（FE7 全量矩阵）。
 * 动态页用受控测试 ID，mock 控制面可命中。browser-smoke 与 api-down-smoke 都从这里取。
 */
export const ROUTES = [
  '/', '/ingestion', '/governance', '/governance/standards', '/governance/mapping', '/governance/quality',
  '/mpi/review', '/assets', '/assets/technical', '/analysis', '/ai-data', '/data-services', '/assistant',
  '/assistant/workspace', '/operations-center', '/delivery-center', '/operations',
  '/ingestion/new',
  '/ingestion/sources/src-lis-001/explorer',
  '/ingestion/jobs/job-lab-result-001',
  '/ingestion/jobs/job-ds-workflow-004?tab=scheduling',
  '/governance/quality/rules/new',
  '/governance/quality/rules/quality.ep.order.paystatus-range/edit',
  '/governance/quality/scoring',
  '/data-services/new',
  '/assistant/workspace/questions/new',
  '/assistant/workspace/questions/medicine-record-daily',
  '/assistant/workspace/questions/medicine-record-daily?tab=try',
  '/assistant/workspace/audit',
]

/** 命令行传了逗号分隔的路由就用它，否则用全量清单。 */
export function resolveRoutes(arg) {
  return arg ? String(arg).split(',').map((item) => item.trim()).filter(Boolean) : ROUTES
}
