/**
 * 门户路由表：生产路由配置，与演示数据无关（曾误居 mock.ts）。
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
  assistant: '/assistant',
  assistantWorkspace: '/assistant/workspace',
  operations: '/operations',
} as const
