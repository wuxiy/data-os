import type { Metric, MpiCandidate, QualityIssue, StandardItem } from '../types'

export const managementMetrics: Metric[] = [
  { label: '接入系统', value: '18', unit: '个', detail: '本月新增 2 个' },
  { label: '核心数据可用率', value: '98.6', unit: '%', detail: '目标 ≥ 99%', tone: 'warning' },
  { label: '标准覆盖率', value: '92.4', unit: '%', detail: '较上月 +3.1%' },
  { label: '主索引准确率', value: '99.2', unit: '%', detail: '待人工审核 36 条' },
  { label: '数据服务', value: '46', unit: '项', detail: '今日调用 12.8 万次' },
  { label: '待闭环问题', value: '23', unit: '项', detail: '其中逾期 4 项', tone: 'danger' },
]

export const governanceMetrics: Metric[] = [
  { label: '标准覆盖率', value: '92.4', unit: '%', detail: '目标 95% · +3.1%' },
  { label: '质量规则通过率', value: '98.6', unit: '%', detail: '目标 99% · -0.4%', tone: 'warning' },
  { label: '问题按时闭环率', value: '86.7', unit: '%', detail: '目标 90% · +5.2%', tone: 'warning' },
  { label: '血缘完整率', value: '94.1', unit: '%', detail: '核心资产 100%' },
  { label: '标准映射覆盖', value: '1,286', unit: '项', detail: '待确认 38 项' },
  { label: '有效数据合同', value: '42', unit: '份', detail: '本周待变更 3 份' },
]

export const standards: StandardItem[] = [
  {
    id: 'STD-001',
    code: 'DE01.00.009.00',
    name: '患者姓名',
    domain: '患者基本信息',
    owner: '医务处',
    status: '已发布',
    updatedAt: '2026-07-29',
    definition: '患者在公安户籍管理部门正式登记注册的姓氏和名称。',
    source: 'WS 364.3—2011',
    valueRange: '中文、英文或符号；长度不超过 50 个字符',
  },
  {
    id: 'STD-002',
    code: 'DE02.01.040.00',
    name: '门诊就诊日期时间',
    domain: '门急诊诊疗',
    owner: '门诊部',
    status: '已发布',
    updatedAt: '2026-07-26',
    definition: '患者本次门诊就诊开始的公历日期和时间。',
    source: 'WS 445.1—2014',
    valueRange: 'YYYY-MM-DD hh:mm:ss',
  },
  {
    id: 'STD-003',
    code: 'DE06.00.193.00',
    name: '疾病诊断编码',
    domain: '诊断与治疗',
    owner: '病案室',
    status: '修订中',
    updatedAt: '2026-07-25',
    definition: '疾病诊断在标准分类体系中的唯一编码。',
    source: 'ICD-10 国家临床版 2.0',
    valueRange: 'ICD-10 国家临床版有效值域',
  },
  {
    id: 'STD-004',
    code: 'DE04.10.188.00',
    name: '检验项目结果值',
    domain: '检验检查',
    owner: '检验科',
    status: '已发布',
    updatedAt: '2026-07-21',
    definition: '针对检验项目测定或观察得到的定量或定性结果。',
    source: 'WS 363.9—2011',
    valueRange: '数值或标准定性描述，与单位共同解释',
  },
  {
    id: 'STD-005',
    code: 'DE08.10.007.00',
    name: '医疗机构组织机构代码',
    domain: '机构与人员',
    owner: '信息中心',
    status: '草稿',
    updatedAt: '2026-07-18',
    definition: '医疗机构依法取得的统一组织机构标识代码。',
    source: '院内主数据规范',
    valueRange: '18 位统一社会信用代码',
  },
]

export const qualityIssues: QualityIssue[] = [
  {
    id: 'DQ-20260801-023',
    title: '门诊诊断编码存在失效值',
    severity: '高',
    status: '待复检',
    object: '门诊就诊事实表 / diagnosis_code',
    department: '门诊部 · 王敏',
    dueAt: '今天 16:00',
    impact: '影响 428 条记录、门诊病种分析与区域上报',
    rule: '疾病诊断编码必须存在于当前有效 ICD-10 值域',
  },
  {
    id: 'DQ-20260801-019',
    title: '检验结果单位缺失',
    severity: '中',
    status: '处理中',
    object: '检验结果表 / result_unit',
    department: '检验科 · 周启',
    dueAt: '明天 10:00',
    impact: '影响 182 条记录、两项临床专病指标',
    rule: '定量检验结果必须同时具有标准计量单位',
  },
  {
    id: 'DQ-20260731-087',
    title: '出院科室未映射标准组织',
    severity: '中',
    status: '待处理',
    object: '住院首页 / discharge_dept_code',
    department: '病案室 · 刘畅',
    dueAt: '8 月 3 日',
    impact: '影响 76 份病案首页与科室绩效口径',
    rule: '业务科室编码必须映射至有效组织主数据',
  },
  {
    id: 'DQ-20260731-064',
    title: '患者证件类型与号码冲突',
    severity: '低',
    status: '已分派',
    object: '患者主索引 / identifier',
    department: '信息中心 · 陈序',
    dueAt: '8 月 5 日',
    impact: '影响 31 位患者的身份合并候选',
    rule: '证件号码格式必须与证件类型一致',
  },
]

export const mpiCandidates: MpiCandidate[] = [
  { id: 'MPI-C-0036', score: 96, leftName: '张伟', rightName: '张伟', system: 'HIS ↔ EMR', risk: '手机号不一致' },
  { id: 'MPI-C-0035', score: 92, leftName: '李晓云', rightName: '李小云', system: 'HIS ↔ 体检', risk: '姓名同音' },
  { id: 'MPI-C-0034', score: 89, leftName: '王建国', rightName: '王建国', system: 'EMR ↔ 区域平台', risk: '地址缺失' },
  { id: 'MPI-C-0033', score: 87, leftName: '赵敏', rightName: '赵敏', system: 'LIS ↔ HIS', risk: '历史号码' },
]

export const riskRanking = [
  { system: 'LIS', owner: '检验科数据管理员', value: '18' },
  { system: 'EMR', owner: '病案室数据管理员', value: '12' },
  { system: '手麻系统', owner: '麻醉科数据管理员', value: '7' },
  { system: '病案首页', owner: '病案室数据管理员', value: '5' },
]
