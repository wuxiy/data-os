export type RouteKey =
  | 'management'
  | 'ingestion'
  | 'governance'
  | 'standards'
  | 'mapping'
  | 'quality'
  | 'mpi'
  | 'assets'
  | 'assetTechnical'
  | 'analytics'
  | 'assistant'
  | 'assistantWorkspace'

export type Tone = 'healthy' | 'warning' | 'danger' | 'neutral'

export interface Metric {
  label: string
  value: string
  unit?: string
  detail: string
  tone?: Tone
}

export interface StandardItem {
  id: string
  code: string
  name: string
  domain: string
  owner: string
  status: string
  updatedAt: string
  definition: string
  source: string
  valueRange: string
}

export interface QualityIssue {
  id: string
  title: string
  severity: '高' | '中' | '低'
  status: string
  object: string
  department: string
  dueAt: string
  impact: string
  rule: string
}

export interface MpiCandidate {
  id: string
  score: number
  leftName: string
  rightName: string
  system: string
  risk: string
}
