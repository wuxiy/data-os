export interface DashboardMetric {
  label: string
  value: string
  delta: string
  tone?: 'healthy' | 'warning' | 'danger'
}

export interface DashboardItem {
  id: string
  bindingId: string
  title: string
  domain: string
  owner: string
  description: string
  updatedAt: string
  status: '运行正常' | '需关注'
  metrics: DashboardMetric[]
  breakdown: Array<{ label: string; value: number; display: string }>
  relatedAssets: string[]
  metricDefinition: string
}

export const dashboards: DashboardItem[] = [
  {
    id: 'dashboard-outpatient',
    bindingId: 'ANA-DSH-0007',
    title: '门诊运营分析',
    domain: '门诊主题',
    owner: '门诊部 · 赵玥',
    description: '跟踪门诊量、复诊率、候诊时长和科室负荷，辅助门诊资源安排。',
    updatedAt: '08-03 09:42',
    status: '运行正常',
    metrics: [
      { label: '今日门诊量', value: '8,426', delta: '较上周同日 +3.8%' },
      { label: '平均候诊时长', value: '26.4 分', delta: '目标 ≤ 30 分' },
      { label: '七日复诊率', value: '12.7%', delta: '较上月 -0.9pp' },
      { label: '高负荷科室', value: '4', delta: '其中 1 个持续两小时', tone: 'warning' },
    ],
    breakdown: [
      { label: '内科门诊', value: 92, display: '1,864 人次' },
      { label: '儿科门诊', value: 79, display: '1,602 人次' },
      { label: '外科门诊', value: 68, display: '1,381 人次' },
      { label: '妇产科门诊', value: 54, display: '1,096 人次' },
    ],
    relatedAssets: ['门诊就诊事实表', '门诊排班主题表', '患者主索引映射'],
    metricDefinition: '按有效挂号且完成接诊的 encounter_id 去重；退号、作废和测试患者不计入。',
  },
  {
    id: 'dashboard-record-quality',
    bindingId: 'ANA-DSH-0012',
    title: '病案首页质量专题',
    domain: '病案主题',
    owner: '病案室 · 刘畅',
    description: '定位首页必填、编码和值域问题，跟踪科室整改与复检成效。',
    updatedAt: '08-03 09:18',
    status: '需关注',
    metrics: [
      { label: '首页完整率', value: '97.6%', delta: '目标 ≥ 98.5%', tone: 'warning' },
      { label: '编码准确率', value: '98.9%', delta: '较上月 +0.7pp' },
      { label: '待整改病案', value: '186', delta: '较昨日减少 27 份' },
      { label: '逾期科室', value: '3', delta: '最早逾期 19 小时', tone: 'danger' },
    ],
    breakdown: [
      { label: '循环内科', value: 88, display: '46 份' },
      { label: '骨科', value: 70, display: '37 份' },
      { label: '神经外科', value: 52, display: '28 份' },
      { label: '普外科', value: 39, display: '21 份' },
    ],
    relatedAssets: ['住院病案首页', '诊断标准映射', '病案质量问题单'],
    metricDefinition: '以病案归档版本为准，按国家病案首页数据质量规范计算完整性与编码一致性。',
  },
  {
    id: 'dashboard-lab-sharing',
    bindingId: 'ANA-DSH-0018',
    title: '区域检验共享监测',
    domain: '检验主题',
    owner: '信息中心 · 陈序',
    description: '观察成员医院检验数据到达、标准化和共享使用情况。',
    updatedAt: '08-03 08:56',
    status: '运行正常',
    metrics: [
      { label: '覆盖机构', value: '11 / 12', delta: '1 家处于联调阶段' },
      { label: '今日共享记录', value: '268.4 万', delta: '较昨日 +4.2%' },
      { label: '标准映射率', value: '96.8%', delta: '待确认 73 项' },
      { label: '准时到达率', value: '99.1%', delta: '目标 ≥ 99%', tone: 'healthy' },
    ],
    breakdown: [
      { label: '市第一人民医院', value: 96, display: '99.7%' },
      { label: '市妇幼保健院', value: 91, display: '99.3%' },
      { label: '市中医院', value: 82, display: '98.8%' },
      { label: '新区人民医院', value: 64, display: '97.4%' },
    ],
    relatedAssets: ['检验结果标准表', '检验项目主数据', '区域机构主数据'],
    metricDefinition: '从采集批次 receive_time 计算到达时延，超过机构约定 SLA 的记录计为迟到。',
  },
]

export interface AssetField {
  name: string
  label: string
  type: string
  standard: string
}

export interface AssetItem {
  id: string
  entityId: string
  name: string
  fqn: string
  type: string
  domain: string
  owner: string
  status: '可信' | '需关注'
  quality: string
  freshness: string
  description: string
  fields: AssetField[]
  uses: string[]
  rules: Array<{ name: string; dimension: string; result: string; checkedAt: string }>
  lineage: Array<{ stage: string; name: string; detail: string; kind: 'source' | 'task' | 'asset' | 'consumer' }>
}

export const assets: AssetItem[] = [
  {
    id: 'asset-outpatient-visit',
    entityId: 'AST-3F8A-91C2',
    name: '门诊就诊事实表',
    fqn: 'clinical.outpatient.fact_encounter',
    type: '主题数据集',
    domain: '门诊主题',
    owner: '门诊部 · 王敏',
    status: '可信',
    quality: '98.9%',
    freshness: '7 分钟前',
    description: '汇总患者一次门诊接诊过程，统一挂号、接诊、诊断、科室与医师标识，用于门诊运营、服务评价和区域上报。',
    fields: [
      { name: 'encounter_id', label: '门诊就诊唯一标识', type: 'varchar(64)', standard: '平台主键规范' },
      { name: 'person_id', label: '患者主索引标识', type: 'varchar(64)', standard: 'MPI.Person' },
      { name: 'visit_time', label: '门诊就诊日期时间', type: 'datetime', standard: 'DE02.01.040.00' },
      { name: 'dept_code', label: '接诊科室代码', type: 'varchar(32)', standard: 'MDM.ORG.DEPT' },
      { name: 'diagnosis_code', label: '主要诊断编码', type: 'varchar(20)', standard: 'ICD-10 国家临床版' },
    ],
    uses: ['门诊运营分析', '门诊服务评价 API', '区域门急诊日报'],
    rules: [
      { name: '就诊标识不得重复', dimension: '唯一性', result: '通过 100%', checkedAt: '09:35' },
      { name: '接诊时间不得晚于当前时间', dimension: '有效性', result: '通过 99.98%', checkedAt: '09:35' },
      { name: '诊断编码必须在有效值域', dimension: '一致性', result: '通过 98.42%', checkedAt: '09:36' },
    ],
    lineage: [
      { stage: '源系统', name: 'HIS 门诊库', detail: 'OP_VISIT / 3 个院区', kind: 'source' },
      { stage: '采集任务', name: '门诊增量同步', detail: '每 5 分钟 · 水位增量', kind: 'task' },
      { stage: '标准模型', name: '门诊就诊事实表', detail: 'L3 门诊主题 · v2.6', kind: 'asset' },
      { stage: '分析消费', name: '门诊运营分析', detail: '6 项指标 · 3 个部门', kind: 'consumer' },
    ],
  },
  {
    id: 'asset-lab-result',
    entityId: 'AST-74D1-A380',
    name: '检验结果标准表',
    fqn: 'clinical.laboratory.fact_lab_result',
    type: '标准数据集',
    domain: '检验主题',
    owner: '检验科 · 周启',
    status: '需关注',
    quality: '96.7%',
    freshness: '18 分钟前',
    description: '统一院内检验项目、结果、单位、参考范围与标本信息，支撑检验互认、专病分析和区域共享。',
    fields: [
      { name: 'report_id', label: '检验报告唯一标识', type: 'varchar(64)', standard: '平台主键规范' },
      { name: 'person_id', label: '患者主索引标识', type: 'varchar(64)', standard: 'MPI.Person' },
      { name: 'item_code', label: '标准检验项目代码', type: 'varchar(32)', standard: 'LOINC / 院级值域' },
      { name: 'result_value', label: '检验结果值', type: 'varchar(128)', standard: 'DE04.10.188.00' },
      { name: 'result_unit', label: '标准计量单位', type: 'varchar(32)', standard: 'UCUM' },
    ],
    uses: ['区域检验共享监测', '检验互认服务', '临床专病数据集'],
    rules: [
      { name: '定量结果必须具有标准单位', dimension: '完整性', result: '通过 96.18%', checkedAt: '09:21' },
      { name: '项目代码必须完成标准映射', dimension: '一致性', result: '通过 97.63%', checkedAt: '09:21' },
      { name: '报告时间不得早于采样时间', dimension: '有效性', result: '通过 99.91%', checkedAt: '09:22' },
    ],
    lineage: [
      { stage: '源系统', name: 'LIS 检验库', detail: 'LAB_RESULT / 12 家机构', kind: 'source' },
      { stage: '采集任务', name: '检验结果增量同步', detail: '每 10 分钟 · 断点续传', kind: 'task' },
      { stage: '标准模型', name: '检验结果标准表', detail: 'L2 医疗语义层 · v1.9', kind: 'asset' },
      { stage: '共享消费', name: '检验互认服务', detail: '2 个 API · 4 个专题', kind: 'consumer' },
    ],
  },
  {
    id: 'asset-inpatient-record',
    entityId: 'AST-5CA2-6E14',
    name: '住院病案首页',
    fqn: 'clinical.inpatient.fact_medical_record',
    type: '主题数据集',
    domain: '病案主题',
    owner: '病案室 · 刘畅',
    status: '可信',
    quality: '97.6%',
    freshness: '32 分钟前',
    description: '整合住院病案首页、诊断、手术、费用和出院信息，保留归档版本并支持质量整改追踪。',
    fields: [
      { name: 'record_id', label: '病案唯一标识', type: 'varchar(64)', standard: '平台主键规范' },
      { name: 'person_id', label: '患者主索引标识', type: 'varchar(64)', standard: 'MPI.Person' },
      { name: 'admit_time', label: '入院日期时间', type: 'datetime', standard: 'WS 445.10—2014' },
      { name: 'discharge_dept_code', label: '出院科室代码', type: 'varchar(32)', standard: 'MDM.ORG.DEPT' },
      { name: 'main_diagnosis_code', label: '主要诊断编码', type: 'varchar(20)', standard: 'ICD-10 国家临床版' },
    ],
    uses: ['病案首页质量专题', 'DRG 分组服务', '国家病案首页上报'],
    rules: [
      { name: '主要诊断不得为空', dimension: '完整性', result: '通过 99.31%', checkedAt: '09:02' },
      { name: '出院科室必须映射组织主数据', dimension: '一致性', result: '通过 98.77%', checkedAt: '09:02' },
      { name: '住院天数必须为非负整数', dimension: '有效性', result: '通过 100%', checkedAt: '09:03' },
    ],
    lineage: [
      { stage: '源系统', name: 'EMR 病案库', detail: 'MR_HOME / 4 个院区', kind: 'source' },
      { stage: '采集任务', name: '病案归档同步', detail: '每 30 分钟 · 版本快照', kind: 'task' },
      { stage: '主题模型', name: '住院病案首页', detail: 'L3 病案主题 · v3.2', kind: 'asset' },
      { stage: '治理消费', name: '病案质量专题', detail: '18 条规则 · 6 个科室', kind: 'consumer' },
    ],
  },
]

export interface AssistantScenario {
  id: string
  title: string
  time: string
  question: string
  answer: string
  finding: string
  chart: Array<{ label: string; value: number; display: string }>
  table: Array<{ department: string; visits: string; wait: string; change: string }>
  sql: string
  sources: Array<{ name: string; detail: string }>
  queryId: string
}

export const assistantScenarios: AssistantScenario[] = [
  {
    id: 'assistant-outpatient',
    title: '门诊量变化原因',
    time: '09:48',
    question: '最近 7 天门诊量为什么比上周下降？',
    answer: '近 7 天门诊总量较上周下降 4.6%，主要由儿科和呼吸内科贡献。周六上午停诊调整影响约 1,126 人次，同时降雨日的爽约率上升 2.3 个百分点。',
    finding: '排除停诊时段后，其他科室门诊量仅下降 1.2%，尚未出现全院性需求下降。',
    chart: [
      { label: '儿科', value: 88, display: '-9.8%' },
      { label: '呼吸内科', value: 66, display: '-7.3%' },
      { label: '消化内科', value: 31, display: '-3.4%' },
      { label: '骨科', value: 12, display: '-1.3%' },
    ],
    table: [
      { department: '儿科', visits: '6,842', wait: '31.6 分', change: '-9.8%' },
      { department: '呼吸内科', visits: '4,156', wait: '28.2 分', change: '-7.3%' },
      { department: '消化内科', visits: '3,728', wait: '24.5 分', change: '-3.4%' },
    ],
    sql: "SELECT dept_name, COUNT(DISTINCT encounter_id) AS visits\nFROM analytics.outpatient_visit_safe\nWHERE visit_date >= CURRENT_DATE - INTERVAL 14 DAY\nGROUP BY dept_name, WEEK(visit_date)\nORDER BY visits DESC\nLIMIT 20;",
    sources: [
      { name: '门诊就诊事实表', detail: '可信 · 7 分钟前更新' },
      { name: '门诊排班主题表', detail: '可信 · 12 分钟前更新' },
      { name: '气象日期维表', detail: '可信 · 今日 06:10 更新' },
    ],
    queryId: 'AIQ-20260803-0948-017',
  },
  {
    id: 'assistant-record',
    title: '病案质量下降定位',
    time: '昨天',
    question: '病案首页完整率下降主要集中在哪些科室和字段？',
    answer: '完整率下降集中在循环内科、骨科和神经外科，主要缺失字段为出院科室、主要手术日期和病理诊断编码。三类字段合计占本周新增问题的 71.4%。',
    finding: '循环内科的问题从 8 月 1 日接口版本切换后开始增加，建议优先核对字段映射版本 v2.3。',
    chart: [
      { label: '循环内科', value: 91, display: '46 份' },
      { label: '骨科', value: 73, display: '37 份' },
      { label: '神经外科', value: 55, display: '28 份' },
      { label: '普外科', value: 41, display: '21 份' },
    ],
    table: [
      { department: '循环内科', visits: '46 份', wait: '出院科室', change: '+18' },
      { department: '骨科', visits: '37 份', wait: '主要手术日期', change: '+11' },
      { department: '神经外科', visits: '28 份', wait: '病理诊断编码', change: '+9' },
    ],
    sql: "SELECT dept_name, failed_field, COUNT(*) AS issue_count\nFROM analytics.medical_record_quality_safe\nWHERE check_date >= CURRENT_DATE - INTERVAL 7 DAY\nGROUP BY dept_name, failed_field\nORDER BY issue_count DESC\nLIMIT 20;",
    sources: [
      { name: '住院病案首页', detail: '可信 · 32 分钟前更新' },
      { name: '病案质量结果表', detail: '可信 · 26 分钟前更新' },
      { name: '标准映射版本记录', detail: 'v2.3 · 08-01 发布' },
    ],
    queryId: 'AIQ-20260802-1611-043',
  },
  {
    id: 'assistant-lab',
    title: '检验共享延迟',
    time: '周五',
    question: '哪些成员医院的检验数据经常晚于约定时间到达？',
    answer: '新区人民医院和市中医院近 30 天迟到率较高，分别为 2.6% 和 1.2%。新区人民医院的延迟集中在每日 02:00—04:00，表现为前置节点积压后集中补传。',
    finding: '新区人民医院磁盘队列峰值达到 68%，仍有安全余量，但补传速率仅为日常速率的 1.4 倍，低于合同目标 2 倍。',
    chart: [
      { label: '新区人民医院', value: 92, display: '2.6%' },
      { label: '市中医院', value: 43, display: '1.2%' },
      { label: '市妇幼保健院', value: 21, display: '0.6%' },
      { label: '市第一人民医院', value: 11, display: '0.3%' },
    ],
    table: [
      { department: '新区人民医院', visits: '2.6%', wait: '36.4 分', change: '+0.8pp' },
      { department: '市中医院', visits: '1.2%', wait: '18.7 分', change: '+0.2pp' },
      { department: '市妇幼保健院', visits: '0.6%', wait: '11.3 分', change: '-0.1pp' },
    ],
    sql: "SELECT institution_name, AVG(delay_minutes) AS avg_delay,\n       SUM(is_late) / COUNT(*) AS late_rate\nFROM analytics.lab_delivery_safe\nWHERE receive_date >= CURRENT_DATE - INTERVAL 30 DAY\nGROUP BY institution_name\nORDER BY late_rate DESC;",
    sources: [
      { name: '检验采集批次表', detail: '可信 · 8 分钟前更新' },
      { name: '前置节点运行记录', detail: '可信 · 2 分钟前更新' },
      { name: '机构数据合同', detail: 'SLA v1.4 · 已生效' },
    ],
    queryId: 'AIQ-20260731-1426-008',
  },
]
