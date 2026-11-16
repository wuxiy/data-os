// 独立审核原型：所有对象与动作均为本地合成示例，不请求业务接口。
import { icons } from './icons.js';
import { mountInteractionPatterns } from './interaction-patterns.js';

const $ = (selector, root = document) => root.querySelector(selector);
const all = (selector, root = document) => [...root.querySelectorAll(selector)];
const icon = (name) => icons[name] || icons.file;
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const badge = (text, tone = '') => `<span class="badge ${tone}">${esc(text)}</span>`;
const action = (name, label, extra = '', className = 'btn') => `<button class="${className}" data-action="${name}" ${extra}>${label}</button>`;
const iconButton = (name, label, event, extra = '') => `<button class="icon-btn bordered" aria-label="${label}" title="${label}" data-action="${event}" ${extra}>${icon(name)}</button>`;
const pageNames = { overview: '总览', ingestion: '数据接入', quality: '数据质量', assets: '数据资产', 'task-editor': '新建采集任务', rules: '规则目录' };
const pageIcons = { overview: 'home', ingestion: 'plug', quality: 'shield', assets: 'database', 'task-editor': 'code', rules: 'list' };
const routeFromHash = () => Object.hasOwn(pageNames, location.hash.slice(1)) ? location.hash.slice(1) : 'overview';

const state = {
  route: routeFromHash(), visited: ['overview', 'ingestion', 'quality', 'assets'], preview: 'normal',
  q: '', status: '', kind: '', page: 1, ingestionTab: 'tasks', qualityTab: 'open', category: 'all',
  selected: new Set(), chartDays: 7, sheet: null, sheetTab: 'evidence', restoreSelector: null,
  hiddenMode: false, hiddenUpdated: false, toastTimer: null,
  issueDrafts: {},
};

const sourceNames = ['门诊 HIS', '住院 EMR', '检验 LIS', '药品管理系统', '影像 PACS', '手术麻醉系统', '病案管理系统', '医院集成平台', '院级字典中心', '门诊处方系统', '患者登记系统', '收费结算系统'];
const taskNames = ['门诊就诊记录增量采集', '住院病历每日同步', '检验报告结果采集', '院级药品目录同步', '门诊处方明细采集', '患者基础信息归集', '手术记录增量采集', '科室标准字典同步'];
const tasks = taskNames.map((name, i) => ({
  id: `COL-${String(i + 1).padStart(3, '0')}`, name, source: sourceNames[[0, 1, 2, 3, 9, 10, 5, 8][i]],
  mode: i === 3 || i === 7 ? '全量' : '增量', frequency: ['每 15 分钟', '每日 02:00', '每 30 分钟', '每日 01:00', '每 15 分钟', '每 1 小时', '每 30 分钟', '每日 03:00'][i],
  enabled: i !== 5 && i !== 7, result: ['成功', '成功', '运行中', '成功', '失败', '未运行', '成功', '成功'][i],
  updated: ['09:30', '02:08', '09:30', '01:12', '09:16', '昨日 18:00', '09:02', '03:05'][i],
}));
const sources = sourceNames.map((name, i) => ({ id: `SRC-${String(i + 1).padStart(3, '0')}`, name, type: ['关系型数据库', '文件交换', '标准接口'][i % 3], department: ['信息中心', '临床数据组', '药学部'][i % 3], checked: i < 9, updated: i < 9 ? '11-16 09:30' : '11-15 16:20' }));
const issueTitles = ['药品编码不符合院级标准', '患者证件号完整性校验未通过', '就诊记录与处方关联缺失', '检验项目名称映射不一致', '出院时间早于入院时间', '科室编码存在未映射值', '处方金额精度不符合要求', '检验报告数据超过更新时限', '就诊类型枚举值不规范', '处方明细主键重复', '药品名称完整性校验'];
const issues = issueTitles.map((name, i) => ({
  id: `DQ-20261116-${String(i + 1).padStart(3, '0')}`, name, index: i,
  asset: ['门诊处方明细', '患者基础信息', '门诊就诊记录', '检验报告结果', '住院病历记录', '科室标准字典', '门诊处方明细', '检验报告结果', '门诊就诊记录', '门诊处方明细', '院级药品目录'][i],
  dimension: ['一致性', '完整性', '关联性', '一致性', '准确性', '一致性', '准确性', '时效性', '有效性', '唯一性', '完整性'][i],
  department: ['药学部', '病案管理科', '信息中心', '检验科', '病案管理科', '信息中心', '药学部', '检验科', '信息中心', '药学部', '药学部'][i],
  owner: ['王', '李', '陈', '周', '李', '陈', '王', '周', '陈', '王', '王'][i],
  risk: i < 2 ? '高' : i < 5 ? '中' : '低', stage: i > 7 ? 'CLOSED' : i === 3 || i === 6 ? 'RECHECKING' : 'OPEN',
  due: i < 2 ? `已逾期 ${i + 1} 小时` : i > 7 ? '已完成' : `剩余 ${[0, 0, 6, 12, 8, 18, 16, 4][i]} 小时`,
  notes: [], requested: false,
}));
const assetDefs = [
  ['门诊就诊记录', 'ods_outpatient_visit', '门诊医疗', 'ODS', 99.2, '信息中心'],
  ['门诊处方明细', 'ods_prescription_detail', '门诊医疗', 'ODS', 96.2, '药学部'],
  ['门诊处方主表', 'ods_prescription', '门诊医疗', 'ODS', 98.7, '药学部'],
  ['门诊科室日汇总', 'dws_outpatient_department_day', '门诊医疗', 'DWS', 100, '数据治理组'],
  ['住院病历记录', 'ods_inpatient_record', '住院医疗', 'ODS', 98.5, '病案管理科'],
  ['住院就诊信息', 'ods_inpatient_visit', '住院医疗', 'ODS', null, '病案管理科'],
  ['住院费用明细', 'ods_inpatient_charge', '住院医疗', 'ODS', 99.5, '财务管理科'],
  ['院级药品目录', 'dim_hospital_drug', '药品管理', 'DIM', 100, '药学部'],
  ['药品主数据', 'dim_drug_master', '药品管理', 'DIM', 99.8, '药学部'],
  ['药品使用日汇总', 'dws_drug_usage_day', '药品管理', 'DWS', null, '药学部'],
  ['患者源身份', 'mpi_source_identity', '患者主索引', 'ODS', 98.1, '信息中心'],
  ['黄金人索引', 'mpi_golden_person', '患者主索引', 'CDM', null, '信息中心'],
];
const assets = assetDefs.map(([name, code, domain, layer, quality, department], i) => ({ id: `AST-${String(i + 1).padStart(3, '0')}`, name, code, domain, layer, quality, department, updated: i > 8 ? '11-15 18:20' : '11-16 09:30' }));

function navigation() {
  const activeRoute = state.route === 'task-editor' ? 'ingestion' : state.route === 'rules' ? 'quality' : state.route;
  const nav = (label, image, route, extra = '') => `<button class="nav-link ${activeRoute === route ? 'active' : ''}" ${route ? `data-route="${route}"` : `data-action="planned" data-label="${label}"`} title="${label}" ${activeRoute === route ? 'aria-current="page"' : ''}>${icon(image)}<span class="nav-label">${label}</span>${extra}</button>`;
  const governance = `<button class="nav-link ${activeRoute === 'quality' ? 'active' : ''}" data-action="governance" title="数据治理" aria-expanded="${activeRoute === 'quality'}">${icon('shield')}<span class="nav-label">数据治理</span><span class="tail">${icon(activeRoute === 'quality' ? 'down' : 'chevron')}</span></button>${activeRoute === 'quality' ? `<div class="nav-sub">${['治理驾驶舱', '数据标准', '标准映射', '数据质量', '血缘与影响', '数据合同'].map((name) => `<button class="nav-link ${name === '数据质量' ? 'active' : ''}" ${name === '数据质量' ? 'data-route="quality" aria-current="page"' : `data-action="planned" data-label="${name}"`}>${name}</button>`).join('')}</div>` : ''}`;
  $('#sidebar').innerHTML = `<div class="brand"><div class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></div><strong>医数中枢</strong><small>DATA OS</small></div>
    <div class="workspace-picker">${icon('building')}<select aria-label="审核工作空间"><option>综合医院 · 数据中心</option><option>集团医院 · 数据中心（示例）</option></select></div>
    <nav class="nav-scroll"><div class="nav-group"><div class="nav-caption">工作概览</div>${nav('总览', 'home', 'overview')}${nav('运营中心', 'chart')}${nav('交付中心', 'layers')}</div>
    <div class="nav-group"><div class="nav-caption">数据管理</div>${nav('数据接入', 'plug', 'ingestion')}${nav('数据资产', 'database', 'assets')}${governance}${nav('患者主索引', 'users', null, '<span class="nav-count">6</span>')}</div>
    <div class="nav-group"><div class="nav-caption">数据应用</div>${nav('数据服务', 'box')}${nav('分析看板', 'chart')}${nav('AI Data', 'sparkle')}${nav('智能问数', 'message')}</div>
    <div class="nav-group"><div class="nav-caption">平台管理</div>${nav('平台运维', 'server')}</div></nav>
    <div class="review-tools"><label>审核工具 · 状态<select aria-label="预览数据状态" id="preview-state"><option value="normal" ${state.preview === 'normal' ? 'selected' : ''}>有数据</option><option value="loading" ${state.preview === 'loading' ? 'selected' : ''}>加载中</option><option value="empty" ${state.preview === 'empty' ? 'selected' : ''}>暂无数据</option><option value="error" ${state.preview === 'error' ? 'selected' : ''}>请求失败</option><option value="pending" ${state.preview === 'pending' ? 'selected' : ''}>待接入</option></select></label></div>
    <button class="user-card" data-action="profile"><span class="avatar">张</span><span class="user-text"><strong>张文博</strong><small>信息中心 · 原型审核员</small></span></button>`;
}

function header() {
  $('#header').innerHTML = `<div class="header-start">${action('collapse', icon('panel'), `aria-label="${document.body.classList.contains('collapsed') ? '展开' : '收起'}导航" title="收起 / 展开导航"`, 'icon-btn')}<span class="v-sep"></span>${action('command', `${icon('search')}<span>搜索页面</span><kbd>⌘ K</kbd>`, 'aria-label="搜索页面，Command K"', 'header-search')}</div>
    <nav class="visited-tabs" aria-label="已打开的页面"><div class="visited-group">${state.visited.map((route) => `<div class="visited-tab ${route === state.route ? 'current' : ''}"><button data-route="${route}" ${route === state.route ? 'aria-current="page"' : ''}>${route === 'overview' ? icon('home') : ''} ${pageNames[route]}</button>${route !== 'overview' ? `<button class="tab-x" aria-label="关闭${pageNames[route]}页签" data-action="close-tab" data-route-key="${route}">${icon('close')}</button>` : ''}</div>`).join('')}</div></nav>
    <div class="header-end">${action('help', icon('circle'), 'aria-label="原型审核说明" title="原型审核说明"', 'icon-btn')}${action('notifications', icon('bell'), 'aria-label="查看演示通知" title="查看通知"', 'icon-btn notify')}<button class="avatar" data-action="profile" aria-label="审核员资料">张</button></div>`;
}

function pageHeading() {
  if (['task-editor', 'rules'].includes(state.route)) return patterns.heading(state.route);
  const data = {
    overview: ['工作概览', '医院数据运营总览', '从数据接入到可信使用，掌握每一条数据链路。'],
    ingestion: ['数据管理', '数据接入', '统一管理数据来源、采集任务与运行记录。'],
    quality: ['数据治理', '数据质量', '定位质量问题，沿证据与责任链推进闭环。'],
    assets: ['数据管理', '数据资产', '发现、理解和追溯可用的医疗数据资产。'],
  }[state.route];
  const buttons = {
    overview: `${action('date', `${icon('calendar')} 最近 7 天 ${icon('down')}`)}${action('goto-quality', '查看待办', '', 'btn primary')}`,
    ingestion: `${action('source-guide', `${icon('link')} 登记数据源`)}${action('new-task', `${icon('plus')} 新建采集任务`, '', 'btn primary')}`,
    quality: `${action('quality-rules', `${icon('list')} 规则目录`)}${action('quality-guide', `${icon('plus')} 登记质量问题`, '', 'btn primary')}`,
    assets: `${action('export', `${icon('download')} 导出目录`)}${action('asset-sync', `${icon('refresh')} 刷新目录`, '', 'btn primary')}`,
  }[state.route];
  return `<div class="breadcrumb">${icon('home')}<span>${data[0]}</span>${icon('chevron')}<span class="last">${pageNames[state.route]}</span><div class="review-mark"><span>设计审核 v0.2</span>全部为合成数据</div></div><div class="page-heading"><div><h1>${data[1]}</h1><p class="page-description">${data[2]}</p></div><div class="heading-actions">${buttons}</div></div>`;
}

function strip(items) {
  return `<div class="summary-strip">${items.map(([label, value, image, note]) => `<div><span class="strip-icon">${icon(image)}</span><div><small>${label}</small><strong>${value}<span>${note || ''}</span></strong></div></div>`).join('')}</div>`;
}

function chart() {
  const y = state.chartDays === 7 ? [120, 108, 100, 109, 83, 65, 53] : [127, 111, 119, 87, 96, 65, 42];
  const line = y.map((v, i) => `${i ? 'L' : 'M'} ${53 + i * 77} ${v}`).join(' ');
  const comparison = y.map((v, i) => `${i ? 'L' : 'M'} ${53 + i * 77} ${v - 13 + i * 2}`).join(' ');
  return `<div class="chart-topline"><span>采集记录（万）</span><div class="legend"><span><i></i>采集记录</span><span><i class="gray"></i>质量通过率</span></div></div><svg class="trend-chart" viewBox="0 0 580 165" role="img" aria-label="最近${state.chartDays}天合成采集趋势与质量通过率，双纵轴"><defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5b8fe9" stop-opacity=".12"/><stop offset="1" stop-color="#5b8fe9" stop-opacity=".01"/></linearGradient></defs>${[25, 60, 95, 130].map((v, i) => `<line x1="48" x2="533" y1="${v}" y2="${v}" stroke="#e8edf4" stroke-dasharray="3 4"/><text x="28" y="${v + 3}">${160 - i * 40}</text><text x="542" y="${v + 3}">${100 - i}.0%</text>`).join('')}<path d="${line} L515 130 L53 130 Z" fill="url(#chart-fill)"/><path d="${comparison}" fill="none" stroke="#b3c4dc" stroke-width="1.5"/><path d="${line}" fill="none" stroke="#4a82df" stroke-width="2"/>${y.map((v, i) => `<circle cx="${53 + i * 77}" cy="${v}" r="3" fill="white" stroke="#4a82df" stroke-width="1.7"><title>11-${10 + i}：${92 + i * 6.1} 万条（合成）</title></circle><text x="${53 + i * 77}" y="152" text-anchor="middle">${state.chartDays === 7 ? `11-${10 + i}` : ['10-18', '10-23', '10-28', '11-02', '11-07', '11-12', '11-16'][i]}</text>`).join('')}</svg>`;
}

function overview() {
  const metrics = [
    ['接入数据源', String(sources.length), '个', 'database', `已检查 ${sources.filter(item => item.checked).length} 个`, `待检查 ${sources.filter(item => !item.checked).length} 个`, 'ingestion'],
    ['今日采集记录', '128.6', '万', 'plug', '较昨日', '+5.1%', 'ingestion'],
    ['质量规则通过率', '98.4', '%', 'shield', '较昨日', '+0.6 个百分点', 'quality'],
    ['待处理事项', '18', '项', 'inbox', '跨 3 个业务域', '查看全部', 'quality'],
  ];
  return `<section class="metrics" aria-label="运营摘要">${metrics.map(([label, value, unit, image, note, change, route]) => `<button class="metric" data-route="${route}"><span class="metric-label">${label}${icon(image)}</span><div class="metric-number">${value}<small>${unit}</small></div><div class="metric-note">${note}<span class="up">${change}</span></div></button>`).join('')}</section>
    <div class="overview-middle"><section class="surface chart-panel"><div class="surface-head"><h2>数据链路概览</h2><div class="segmented" aria-label="趋势周期"><button data-action="chart-period" data-days="7" class="${state.chartDays === 7 ? 'active' : ''}" aria-pressed="${state.chartDays === 7}">近 7 天</button><button data-action="chart-period" data-days="30" class="${state.chartDays === 30 ? 'active' : ''}" aria-pressed="${state.chartDays === 30}">近 30 天</button></div></div>${chart()}</section>
    <section class="surface"><div class="surface-head"><h2>待办事项</h2><span class="subtle">需要你的关注</span></div><ol class="todo-list">${[['数据质量问题', '规则校验未通过，等待处理', '8', 'goto-quality'], ['主索引人工复核', '待核对的患者身份候选对', '6', 'planned'], ['数据合同待确认', '服务变更需要确认影响范围', '4', 'planned']].map(([name, note, count, event], i) => `<li><button data-action="${event}" data-label="${name}"><span class="todo-num">${i + 1}</span><span class="todo-copy"><strong>${name}</strong><small>${note}</small></span><b>${count}</b>${icon('chevron')}</button></li>`).join('')}</ol></section></div>
    <div class="overview-bottom"><section class="surface"><div class="surface-head"><h2>优先处理<span class="count">4</span></h2>${action('goto-quality', `全部待办 ${icon('chevron')}`, '', 'text-btn')}</div><div class="table-wrap"><table class="priority-table"><thead><tr><th>问题 / 事项</th><th>责任部门</th><th>优先级</th><th>状态</th><th>操作</th></tr></thead><tbody>${[issues[0], issues[1], { ...issues[2], name: '门诊处方采集运行异常', department: '信息中心', isRun: true }, issues[2]].map((item, i) => `<tr><td><div class="cell-title">${item.name}</div><div class="cell-meta">${item.isRun ? '数据接入 · COL-005' : `数据质量 · ${item.id.slice(-3)}`}</div></td><td>${item.department}</td><td>${badge(i < 2 ? '高' : '中', i < 2 ? 'danger' : 'warn')}</td><td><span class="status"><i></i>待处理</span></td><td>${action(item.isRun ? 'goto-ingestion' : 'open-issue', '处理', `data-id="${item.id}"`, 'text-btn')}</td></tr>`).join('')}</tbody></table></div></section>
    <section class="surface"><div class="surface-head"><h2>最近事件</h2><span class="subtle">今日</span></div><div class="events"><ol class="timeline"><li><div class="event-title">门诊就诊记录采集完成</div><p>合成运行新增 12.8 万条记录</p><span class="event-time">09:30 · 数据接入</span></li><li><div class="event-title">质量问题进入复检队列</div><p>检验项目名称映射，等待异步结果</p><span class="event-time">09:18 · 数据质量</span></li><li><div class="event-title">资产结构元数据已更新</div><p>门诊处方明细，字段定义已同步</p><span class="event-time">08:52 · 数据资产</span></li></ol></div></section></div>`;
}

function searchBox(placeholder) {
  return `<label class="search-field">${icon('search')}<input id="table-search" type="search" aria-label="${placeholder}" placeholder="${placeholder}" value="${esc(state.q)}" autocomplete="off" /></label>`;
}
function filterSelect(label, key, options) {
  return `<select class="filter-select" data-filter="${key}" aria-label="${label}"><option value="">${label}</option>${options.map(([value, title]) => `<option value="${value}" ${state[key] === value ? 'selected' : ''}>${title}</option>`).join('')}</select>`;
}
function tableTools() {
  return `<div class="toolbar-right">${iconButton('refresh', '刷新列表', 'refresh')}<div class="popover-anchor">${iconButton('columns', '显示列', 'columns', 'aria-expanded="false"')}<div class="popover" id="columns-popover" hidden><strong>显示列</strong><label><input type="checkbox" data-column="mode" ${state.hiddenMode ? '' : 'checked'} />${state.route === 'assets' ? '业务域' : state.route === 'quality' ? '优先级' : '采集模式'}</label><label><input type="checkbox" data-column="updated" ${state.hiddenUpdated ? '' : 'checked'} />更新时间 / 处理时限</label>${action('reset-columns', '重置显示列', '', 'text-btn')}</div></div>${iconButton('expand', '全屏表格', 'expand', 'aria-pressed="false"')}</div>`;
}
function pagination(total, pageSize = 6) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  state.page = Math.min(state.page, pageCount);
  return `<div class="pagination"><span>共 ${total} 条记录 ${total ? `· 第 ${(state.page - 1) * pageSize + 1}–${Math.min(state.page * pageSize, total)} 条` : ''}</span><div class="page-buttons"><span style="margin-right:7px">每页 ${pageSize} 条</span><button class="page-num" aria-label="上一页" data-action="page" data-page="${state.page - 1}" ${state.page <= 1 ? 'disabled' : ''}>${icon('arrowleft')}</button>${Array.from({ length: pageCount }, (_, i) => `<button class="page-num ${state.page === i + 1 ? 'active' : ''}" data-action="page" data-page="${i + 1}" ${state.page === i + 1 ? 'aria-current="page"' : ''}>${i + 1}</button>`).join('')}<button class="page-num" aria-label="下一页" data-action="page" data-page="${state.page + 1}" ${state.page >= pageCount ? 'disabled' : ''}>${icon('chevron')}</button></div></div>`;
}
function matches(item, values) { return values.some((value) => String(item[value] || '').toLowerCase().includes(state.q.toLowerCase())); }
function noResults() { return `<div class="empty-state"><div class="empty-icon">${icon('search')}</div><h2>没有符合条件的记录</h2><p>尝试调整关键词或筛选条件，查看其他记录。</p>${action('clear-filters', '清除筛选')}</div>`; }
function resultStatus(value) { return `<span class="status ${value === '成功' ? 'good' : value === '失败' ? 'bad' : value === '运行中' ? 'running' : ''}"><i></i>${value}</span>`; }

function ingestion() {
  const enabled = tasks.filter((item) => item.enabled).length;
  return `${strip([['登记数据源', sources.length, 'database', '个'], ['采集任务', tasks.length, 'plug', '个'], ['已启用任务', enabled, 'checkcircle', '个'], ['最近 24h 失败', '1', 'alert', '次']])}<section class="surface" id="list-surface"><div class="business-tabs" role="tablist" aria-label="数据接入类型">${[['sources', '数据源', sources.length], ['tasks', '采集任务', tasks.length], ['runs', '运行记录', 12]].map(([value, name, count]) => `<button role="tab" aria-selected="${state.ingestionTab === value}" class="business-tab ${state.ingestionTab === value ? 'active' : ''}" data-action="ingestion-tab" data-value="${value}">${name}<span class="count">${count}</span></button>`).join('')}</div><div class="toolbar"><div class="toolbar-left">${searchBox(state.ingestionTab === 'sources' ? '搜索数据源名称或编号' : '搜索任务名称、数据源或编号')}${filterSelect('全部状态', 'status', state.ingestionTab === 'sources' ? [['checked', '已检查'], ['pending', '待检查']] : state.ingestionTab === 'runs' ? [['成功', '成功'], ['失败', '失败'], ['运行中', '运行中']] : [['enabled', '已启用'], ['paused', '已暂停']])}${state.ingestionTab === 'tasks' ? filterSelect('全部模式', 'kind', [['增量', '增量采集'], ['全量', '全量采集']]) : ''}</div>${tableTools()}</div><div id="data-region">${ingestionTable()}</div></section>`;
}

function ingestionTable() {
  if (state.ingestionTab === 'sources') {
    const filtered = sources.filter((item) => matches(item, ['name', 'id', 'department']) && (!state.status || (state.status === 'checked') === item.checked));
    const pager = pagination(filtered.length);
    return filtered.length ? `<div class="scope-plain">登记与连通性检查分开呈现；已检查不代表业务采集已经完成。</div><div class="table-wrap"><table><thead><tr><th>数据源名称</th><th>接入方式</th><th>管理部门</th><th>配置状态</th><th class="updated-column">更新时间</th><th>操作</th></tr></thead><tbody>${filtered.slice((state.page - 1) * 6, state.page * 6).map((item) => `<tr><td><div class="cell-title">${item.name}</div><div class="cell-meta">${item.id}</div></td><td>${item.type}</td><td>${item.department}</td><td>${badge(item.checked ? '已检查' : '待检查', item.checked ? 'success' : '')}</td><td class="updated-column">${item.updated}</td><td>${action('source-detail', '查看', `data-id="${item.id}"`, 'text-btn')}</td></tr>`).join('')}</tbody></table></div>${pager}` : noResults();
  }
  if (state.ingestionTab === 'runs') {
    const rows = Array.from({ length: 12 }, (_, i) => ({ ...tasks[i % tasks.length], runId: `RUN-20261116-${String(12 - i).padStart(3, '0')}` })).filter((item) => matches(item, ['name', 'source', 'runId']) && (!state.status || state.status === item.result));
    const pager = pagination(rows.length);
    return rows.length ? `<div class="table-wrap"><table><thead><tr><th>执行批次 / 任务</th><th>数据源</th><th>执行状态</th><th>业务记录数</th><th class="updated-column">开始时间</th><th>操作</th></tr></thead><tbody>${rows.slice((state.page - 1) * 6, state.page * 6).map((item, i) => `<tr><td><div class="cell-title">${item.name}</div><div class="cell-meta">${item.runId}</div></td><td>${item.source}</td><td>${resultStatus(item.result)}</td><td>${item.result === '成功' ? `${(128600 - i * 6800).toLocaleString()} 条` : '—'}</td><td class="updated-column">11-16 ${item.updated}</td><td>${action('task-detail', '查看', `data-id="${item.id}"`, 'text-btn')}</td></tr>`).join('')}</tbody></table></div>${pager}` : noResults();
  }
  const filtered = tasks.filter((item) => matches(item, ['name', 'source', 'id']) && (!state.status || (state.status === 'enabled') === item.enabled) && (!state.kind || item.mode === state.kind));
  const pager = pagination(filtered.length);
  const selected = state.selected.size ? `<div class="selected-bar">已选择 ${state.selected.size} 项${action('batch-pause', '模拟暂停', '', '')}${action('clear-selected', '取消选择', '', '')}</div>` : '';
  return filtered.length ? `${selected}<div class="table-wrap"><table><thead><tr><th class="check-col"><input type="checkbox" aria-label="选择当前页全部任务" id="select-all" ${filtered.slice((state.page - 1) * 6, state.page * 6).every((item) => state.selected.has(item.id)) ? 'checked' : ''} /></th><th>采集任务</th><th>数据源</th><th class="mode-column">模式</th><th>调度周期</th><th>最近运行</th><th>任务状态</th><th class="updated-column">更新时间</th><th>操作</th></tr></thead><tbody>${filtered.slice((state.page - 1) * 6, state.page * 6).map((item) => `<tr class="${state.selected.has(item.id) ? 'selected' : ''}"><td class="check-col"><input type="checkbox" aria-label="选择${item.name}" data-select="${item.id}" ${state.selected.has(item.id) ? 'checked' : ''} /></td><td><button class="cell-link" data-action="task-detail" data-id="${item.id}"><div class="cell-title">${esc(item.name)}</div><div class="cell-meta">${item.id}</div></button></td><td>${item.source}</td><td class="mode-column">${badge(item.mode)}</td><td style="font-size:11px">${item.frequency}</td><td>${resultStatus(item.result)}</td><td>${badge(item.enabled ? '已启用' : '已暂停', item.enabled ? 'blue' : '')}</td><td class="updated-column" style="font-size:11px">${item.updated}</td><td><div class="row-actions">${action('task-detail', '查看', `data-id="${item.id}"`, 'text-btn')}${action('toggle-task', icon(item.enabled ? 'pause' : 'play'), `data-id="${item.id}" aria-label="${item.enabled ? '暂停' : '启用'}${esc(item.name)}" title="${item.enabled ? '模拟暂停' : '模拟启用'}"`, 'icon-btn')}</div></td></tr>`).join('')}</tbody></table></div>${pager}` : noResults();
}

function quality() {
  const rechecking = issues.filter((item) => item.stage === 'RECHECKING').length;
  return `${strip([['待闭环问题', issues.filter((item) => item.stage !== 'CLOSED').length, 'inbox', '项'], ['复检中', rechecking, 'refresh', '项'], ['近 7 日已关闭', '3', 'checkcircle', '项'], ['处理时限已逾期', '2', 'clock', '项']])}<section class="surface" id="list-surface"><div class="business-tabs" role="tablist" aria-label="质量问题范围">${[['open', '待闭环', 8], ['closed', '已关闭', 3], ['all', '全部问题', 11]].map(([key, title, count]) => `<button role="tab" aria-selected="${state.qualityTab === key}" class="business-tab ${state.qualityTab === key ? 'active' : ''}" data-action="quality-tab" data-value="${key}">${title}<span class="count">${count}</span></button>`).join('')}</div><div class="toolbar"><div class="toolbar-left">${searchBox('搜索问题、资产名称或编号')}${filterSelect('全部优先级', 'kind', [['高', '高优先级'], ['中', '中优先级'], ['低', '低优先级']])}${filterSelect('全部状态', 'status', [['OPEN', '待处理'], ['RECHECKING', '复检中'], ['CLOSED', '已关闭']])}</div>${tableTools()}</div><div id="data-region">${qualityTable()}</div></section>`;
}
function qualityTable() {
  const filtered = issues.filter((item) => matches(item, ['name', 'asset', 'id', 'department']) && (!state.kind || item.risk === state.kind) && (!state.status || item.stage === state.status) && (state.qualityTab === 'all' || (state.qualityTab === 'closed') === (item.stage === 'CLOSED')));
  const pager = pagination(filtered.length);
  return filtered.length ? `<div class="table-wrap"><table class="quality-table"><thead><tr><th>质量问题 / 关联资产</th><th>质量维度</th><th class="mode-column">优先级</th><th>责任部门</th><th class="updated-column">处理时限</th><th>状态</th><th>操作</th></tr></thead><tbody>${filtered.slice((state.page - 1) * 6, state.page * 6).map((item) => `<tr><td><button class="cell-link" data-action="open-issue" data-id="${item.id}"><div class="cell-title">${item.name}</div><div class="cell-meta">${item.id} · ${item.asset}</div></button></td><td>${item.dimension}</td><td class="mode-column">${badge(`${item.risk}优先级`, item.risk === '高' ? 'danger' : item.risk === '中' ? 'warn' : '')}</td><td><div class="row-owner"><span class="avatar sm">${item.owner}</span>${item.department}</div></td><td class="updated-column"><span class="due ${item.due.startsWith('已逾期') ? 'over' : ''}">${item.due}</span></td><td>${badge(item.stage === 'RECHECKING' ? '复检中' : item.stage === 'CLOSED' ? '已关闭' : '待处理', item.stage === 'RECHECKING' ? 'blue' : item.stage === 'CLOSED' ? 'success' : '')}</td><td>${action('open-issue', '查看', `data-id="${item.id}"`, 'text-btn')}</td></tr>`).join('')}</tbody></table></div>${pager}` : noResults();
}

function assetPage() {
  return `${strip([['目录资产', '12', 'database', '项'], ['业务域', '4', 'folder', '个'], ['已执行质量评估', '9', 'shield', '项'], ['待评估', '3', 'clock', '项']])}<section class="surface asset-layout" id="list-surface"><aside class="asset-tree" aria-label="资产分类"><h3>资产范围</h3><button class="tree-link ${state.category === 'all' ? 'active' : ''}" data-action="asset-category" data-value="all">${icon('layers')}全部资产<b>12</b></button><div class="tree-label">按业务域</div>${['门诊医疗', '住院医疗', '药品管理', '患者主索引'].map((name) => `<button class="tree-link ${state.category === name ? 'active' : ''}" data-action="asset-category" data-value="${name}">${icon('folder')}${name}<b>${assets.filter((item) => item.domain === name).length}</b></button>`).join('')}<div class="tree-label">按数据分层</div>${['ODS', 'DIM', 'DWS', 'CDM'].map((name) => `<button class="tree-link ${state.category === name ? 'active' : ''}" data-action="asset-category" data-value="${name}">${icon('table')}${name}<b>${assets.filter((item) => item.layer === name).length}</b></button>`).join('')}<div class="tree-note">目录展示结构元数据。<br>质量结果与认证状态独立呈现。</div></aside><div class="asset-main"><div class="toolbar"><div class="toolbar-left">${searchBox('搜索资产名称或表名')}${filterSelect('全部质量状态', 'status', [['assessed', '已评估'], ['pending', '待评估']])}</div>${tableTools()}</div><div class="scope-plain">业务定义、字段结构、质量与上下游影响，在同一资产上下文中查看。</div><div id="data-region">${assetTable()}</div></div></section>`;
}
function assetTable() {
  const filtered = assets.filter((item) => matches(item, ['name', 'code', 'department']) && (state.category === 'all' || item.domain === state.category || item.layer === state.category) && (!state.status || (state.status === 'assessed') === (item.quality !== null)));
  const pager = pagination(filtered.length);
  return filtered.length ? `<div class="table-wrap"><table class="asset-table"><thead><tr><th>数据资产</th><th class="mode-column">业务域</th><th>质量结果</th><th>责任部门</th><th class="updated-column">结构更新</th><th>操作</th></tr></thead><tbody>${filtered.slice((state.page - 1) * 6, state.page * 6).map((item) => `<tr><td><button class="cell-link asset-name" data-action="open-asset" data-id="${item.id}"><span class="asset-symbol">${icon('table')}</span><span><span class="cell-title">${item.name}</span><span class="cell-meta" style="display:block">${item.code}</span></span></button></td><td class="mode-column">${item.domain}</td><td>${item.quality === null ? '<span class="subtle">— 待评估</span>' : `<span class="asset-score">${item.quality.toFixed(1)}%<small>通过率</small></span>`}</td><td>${item.department}</td><td class="updated-column">${item.updated}</td><td>${action('open-asset', '详情', `data-id="${item.id}"`, 'text-btn')}</td></tr>`).join('')}</tbody></table></div>${pager}` : noResults();
}

function previewState() {
  if (state.preview === 'normal') return null;
  if (state.preview === 'loading') return `<section class="surface" aria-label="正在加载数据" aria-busy="true"><div class="skeleton-body"><div class="skeleton-line" style="width:130px;height:18px;margin-bottom:25px"></div>${Array.from({ length: 6 }, () => `<div class="skeleton-row"><div class="skeleton-line" style="flex:2"></div><div class="skeleton-line"></div><div class="skeleton-line"></div><div class="skeleton-line"></div></div>`).join('')}<p class="subtle" style="margin-top:20px">正在读取数据，请稍候…</p></div></section>`;
  const info = {
    empty: ['inbox', '还没有可展示的数据', '当前范围没有记录。可以调整范围，或查看有数据时的审核样例。', '查看审核样例'],
    error: ['alert', '暂时无法读取数据', '数据服务暂时不可用。保留当前位置与操作入口，恢复后可以重试。', '重新加载'],
    pending: ['plug', '等待接入数据服务', '此工作区尚未配置数据来源。接入后会显示可追溯的业务结果。', '查看接入指引'],
  }[state.preview];
  return `<section class="surface empty-state"><div class="empty-icon">${icon(info[0])}</div><h2>${info[1]}</h2><p>${info[2]}</p>${action(state.preview === 'pending' ? 'pending-guide' : 'restore-preview', info[3])}</section>`;
}
function render() {
  document.title = `${pageNames[state.route]} · 医数中枢 · 设计审核`;
  navigation(); header();
  $('#main').innerHTML = `${pageHeading()}<div id="page-content">${previewState() || (['task-editor', 'rules'].includes(state.route) ? patterns.content(state.route) : ({ overview, ingestion, quality, assets: assetPage }[state.route])())}</div><footer class="page-foot"><span>样例快照：2026-11-16 09:30</span><span>审核原型 · 合成数据 · 本地交互</span></footer>`;
  syncColumnClasses();
  patterns.afterRender();
}
function updateTable() {
  const focused = document.activeElement;
  const restore = focused?.dataset.select ? `[data-select="${focused.dataset.select}"]` : focused?.id === 'select-all' ? '#select-all' : null;
  const host = $('#data-region');
  if (host) host.innerHTML = ({ ingestion: ingestionTable, quality: qualityTable, assets: assetTable }[state.route])();
  syncColumnClasses();
  if (restore) $(restore)?.focus({ preventScroll: true });
}
function syncColumnClasses() { const surface = $('#list-surface'); if (surface) { surface.classList.toggle('hide-mode', state.hiddenMode); surface.classList.toggle('hide-updated', state.hiddenUpdated); } }
function go(route) {
  if (!Object.hasOwn(pageNames, route)) return;
  if (route === state.route && route === 'task-editor') return;
  if (patterns.beforeNavigate(route)) return;
  state.route = route; state.q = ''; state.kind = ''; state.status = ''; state.page = 1; state.selected.clear();
  state.preview = 'normal'; if (!state.visited.includes(route)) state.visited.push(route);
  if (location.hash !== `#${route}`) history.replaceState(null, '', `#${route}`);
  render(); window.scrollTo({ top: 0 });
}
function toast(message) { clearTimeout(state.toastTimer); $('#toast').innerHTML = `${icon('info')}${esc(message)}`; $('#toast').classList.add('visible'); state.toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3700); }

function openModal(title, html, command = false) {
  patterns.prepareModal();
  if ($('#modal').open) $('#modal').close();
  $('#modal').classList.toggle('command', command);
  $('#modal').innerHTML = `<div class="modal-head"><h2 id="modal-title">${title}</h2>${action('close-modal', icon('close'), 'aria-label="关闭对话框"', 'icon-btn')}</div><div class="modal-content">${html}</div>`;
  $('#modal').showModal();
  if (command) $('#command-search').focus();
}
function planned(label) { openModal(label || '后续页面', `<p>此入口保留在完整业务地图中，本轮先审核四个代表页面：</p><p style="margin-top:9px;color:#4d6589">总览 → 数据接入 → 数据质量 → 数据资产</p><p style="margin-top:10px">其余页面将在整体风格确认后沿用同一体系展开。</p>${action('close-modal', '继续审核', '', 'btn primary')}`); }

function openSheet(type, id) {
  state.restoreSelector = id ? `[data-action="${type === 'issue' ? 'open-issue' : type === 'asset' ? 'open-asset' : 'task-detail'}"][data-id="${id}"]` : '[data-action="new-task"]';
  state.sheet = { type, id }; state.sheetTab = type === 'asset' ? 'overview' : 'evidence';
  renderSheet(); $('#sheet').showModal();
}
function sheetTabs(items) { return `<div class="business-tabs" role="tablist" aria-label="详情内容">${items.map(([key, title]) => `<button role="tab" aria-selected="${state.sheetTab === key}" class="business-tab ${state.sheetTab === key ? 'active' : ''}" data-action="sheet-tab" data-value="${key}">${title}</button>`).join('')}</div>`; }
function sheetFrame(title, subtitle, body, footer) {
  return `<header class="sheet-head"><div class="sheet-head-top"><div><h2 id="sheet-title">${title}</h2><p class="sheet-subtitle">${subtitle}</p></div>${action('close-sheet', icon('close'), 'aria-label="关闭详情" title="关闭，Esc"', 'icon-btn')}</div></header><div class="sheet-scroll">${body}</div><footer class="sheet-footer">${footer}</footer>`;
}
function renderSheet() {
  const data = state.sheet;
  if (!data) return;
  $('#sheet').innerHTML = data.type === 'issue' ? issueSheet(issues.find((item) => item.id === data.id)) : data.type === 'asset' ? assetSheet(assets.find((item) => item.id === data.id)) : data.type === 'task' ? taskSheet(tasks.find((item) => item.id === data.id)) : ''; 
}

function issueSheet(item) {
  const descriptions = [
    '部分药品编码未与院级标准目录建立有效映射，涉及 127 个编码、312 条处方记录，可能影响药品使用统计与标准化分析。',
    '患者基础信息中的证件类型与证件标识存在必填项缺失，影响身份关联的完整性。本原型仅展示缺失类型和聚合次数，不展示患者信息。',
    '部分处方记录引用的就诊键未在就诊记录中找到，影响跨表分析的关联完整性。证据只展示合成异常类型与聚合次数。',
    '检验项目名称与院级标准项目的映射存在差异，可能影响跨系统结果对照。需要先核对映射版本，再登记复检。',
    '合成记录中存在出院时间早于入院时间的逻辑冲突，影响住院时长统计。只展示冲突类型，不展示行级记录。',
    '部分科室编码尚未完成院级标准映射，影响归口统计。需要由责任部门补全映射依据后复检。',
    '处方金额的小数精度未满足约定，可能影响汇总口径。证据仅展示合成的精度异常分类。',
    '检验报告的最近更新时间超过约定时限，需要确认来源链路与增量位点，不能仅凭执行器健康判断业务完成。',
    '就诊类型中出现字典范围外的值；此合成事件已经关闭，保留历史聚合证据用于追溯。',
    '处方明细主键曾出现重复；此合成事件已经关闭，保留聚合证据，不展示行级患者记录。',
    '院级药品目录曾存在名称缺失；此合成事件已经关闭，保留规则与处理记录。',
  ];
  const subjectAsset = assets.find((asset) => asset.name === item.asset);
  const samplePrefix = ['DRUG', 'MISSING', 'RELATION', 'MAPPING', 'TIME', 'DEPT', 'PRECISION', 'LAG', 'ENUM', 'DUPLICATE', 'NAME'][item.index];
  const ruleName = item.index === 0 ? '院级药品编码一致性规则' : `${item.dimension}校验规则`;
  const score = item.stage === 'CLOSED' ? '100.0' : ['96.2', '98.7', '99.1', '97.8', '99.3', '98.0', '99.5', '94.6'][item.index];
  const stage = item.stage === 'RECHECKING' ? '复检中' : item.stage === 'CLOSED' ? '已关闭' : '待处理';
  const top = `<div class="sheet-body" style="padding-bottom:0"><div class="detail-meta">${badge(stage, item.stage === 'RECHECKING' ? 'blue' : item.stage === 'CLOSED' ? 'success' : '')}<span>更新于 11-16 09:30</span><span>合成审核事件</span></div><h3 class="sheet-subject">${item.name}</h3><div class="detail-meta"><span>关联资产：${item.asset}</span><span>责任部门：${item.department}</span><span class="due ${item.due.startsWith('已逾期') ? 'over' : ''}">${item.due}</span></div></div>`;
  let content;
  if (state.sheetTab === 'chain') {
    const nodes = [
      ['shield', '质量事件', item.id, 'issueId', '质量检查服务'],
      ['database', item.asset, subjectAsset?.id || `AST-DEMO-${item.index + 1}`, 'assetId', '数据资产目录'],
      ['file', ruleName, `RULE-${samplePrefix}-004`, 'ruleId', '质量规则库'],
      ['user', `${item.department} · ${item.owner}老师`, `OWNER-DEPT-${item.index + 1}`, 'ownerId', '组织与权限目录'],
      ['inbox', `${item.dimension}问题处理`, `TICKET-20261116-${String(item.index + 1).padStart(3, '0')}`, 'ticketId', '治理工单'],
    ];
    content = `<div class="inline-notice">${icon('info')}五类对象通过稳定编号关联。本图为审核样例，真实事件绑定仍需接口验证。</div><div class="chain">${nodes.map(([image, title, id, key, source]) => `<div class="chain-node"><span class="node-icon">${icon(image)}</span><strong>${title}</strong><small class="node-key">${key}: ${id}</small><small>来源：${source} · 11-16 09:30</small></div>`).join('')}</div>`;
  } else if (state.sheetTab === 'records') {
    content = `<ol class="timeline">${item.notes.map((note) => `<li><div class="event-title">已添加处理说明<span class="event-time">刚刚</span></div><p>${esc(note)}</p></li>`).join('')}${item.requested ? '<li><div class="event-title">复检请求已登记<span class="event-time">刚刚</span></div><p>已进入演示提交队列，等待执行器异步回写。</p></li>' : ''}<li><div class="event-title">问题已分派给责任部门<span class="event-time">09:26</span></div><p>${item.department}负责处理；已保留事件与规则关联。</p></li><li><div class="event-title">规则发现质量问题<span class="event-time">09:20</span></div><p>生成合成事件 ${item.id}。</p></li></ol>`;
  } else {
    content = `${item.requested ? `<div class="inline-notice">${icon('clock')}复检请求已登记。等待提交、执行和结果回写；登记不代表校验通过。</div>` : ''}<div class="quality-score"><div><span class="value">${score}<small>%</small></span><div class="threshold">本次规则通过率</div></div><div style="border-left:1px solid var(--line);padding-left:22px"><div style="font-size:12px;color:#6c7d94">规则要求 100%</div><div class="threshold" style="margin-top:5px">${item.dimension} · 院级标准 · 合成结果</div></div></div><div class="detail-section" style="margin-top:0"><h3>发现与影响</h3><p>${descriptions[item.index]}</p></div><div class="detail-section"><h3>聚合证据<span class="subtle" style="font-weight:400;margin-left:8px">仅展示违规值与次数</span></h3><div class="mini-table"><table><thead><tr><th>${item.index === 0 ? '违规编码' : '异常分类（合成）'}</th><th>出现次数</th><th>规则结论</th></tr></thead><tbody><tr><td class="sample-id">DEMO-${samplePrefix}-018</td><td>86</td><td>${item.index === 0 ? '标准目录中不存在' : '未满足规则约定'}</td></tr><tr><td class="sample-id">DEMO-${samplePrefix}-042</td><td>64</td><td>${item.index === 0 ? '标准目录中不存在' : '未满足规则约定'}</td></tr><tr><td class="sample-id">DEMO-${samplePrefix}-096</td><td>38</td><td>${item.index === 0 ? '编码已停用' : '未满足规则约定'}</td></tr></tbody></table></div></div><div class="detail-section"><h3>处理说明</h3><label class="form-field" style="margin-bottom:6px"><textarea id="issue-note" aria-label="处理说明" placeholder="补充处理进展、修复依据或待协调事项…">${esc(state.issueDrafts[item.id] || '')}</textarea></label>${action('save-note', '保存处理说明', '', 'text-btn')}</div>`;
  }
  const body = `${top}${sheetTabs([['evidence', '证据与影响'], ['records', '处理记录'], ['chain', '关联链路']])}<div class="sheet-body">${content}</div>`;
  const footer = `<div class="footer-hint">审核原型：动作仅更新本地合成状态。</div><div class="footer-actions">${action('close-sheet', '关闭')}${action('remind', '提醒责任人', item.stage === 'CLOSED' ? 'disabled' : '')}${action('recheck', `${icon('refresh')} ${item.stage === 'RECHECKING' ? '已登记 / 复检中' : item.stage === 'CLOSED' ? '问题已关闭' : '开始复检'}`, item.stage === 'OPEN' ? '' : 'disabled', 'btn primary')}</div>`;
  return sheetFrame('质量问题详情', `${item.id} · 治理责任链`, body, footer);
}

function assetSheet(item) {
  const isDrug = item.domain === '药品管理';
  const isPatient = item.domain === '患者主索引';
  const isInpatient = item.domain === '住院医疗';
  const isPrescription = item.code.includes('prescription');
  const descriptions = {
    '门诊就诊记录': '统一记录门诊就诊的基本业务信息，用于门诊业务统计、质量分析及数据服务。目录只呈现结构与定义，不展示患者行级信息。',
    '门诊处方明细': '按处方明细粒度记录药品与用法信息，用于院级药品标准化、处方质量治理与用药分析。',
  };
  let content;
  if (state.sheetTab === 'fields') {
    const fields = isDrug
      ? [['drug_code', 'VARCHAR(64)', '否', '院级药品编码'], ['drug_name', 'VARCHAR(256)', '否', '药品标准名称'], ['specification', 'VARCHAR(128)', '是', '药品规格'], ['dosage_unit', 'VARCHAR(32)', '是', '计量单位'], ['institution_code', 'VARCHAR(32)', '否', '医疗机构编码'], ['source_system', 'VARCHAR(32)', '否', '来源系统标识'], ['updated_at', 'DATETIME', '否', '最后更新时间']]
      : isPatient
        ? [['identity_key', 'VARCHAR(128)', '否', '源身份或黄金人标识'], ['institution_code', 'VARCHAR(32)', '否', '医疗机构编码'], ['source_system', 'VARCHAR(32)', '否', '来源系统标识'], ['source_key', 'VARCHAR(128)', '是', '源登记主键'], ['link_status', 'VARCHAR(32)', '否', '身份关联状态'], ['created_at', 'DATETIME', '否', '创建时间'], ['updated_at', 'DATETIME', '否', '最后更新时间']]
        : [[isPrescription ? 'prescription_id' : 'visit_id', 'VARCHAR(64)', '否', isPrescription ? '处方唯一标识' : '就诊唯一标识'], ['institution_code', 'VARCHAR(32)', '否', '医疗机构编码'], ['department_code', 'VARCHAR(32)', '否', '就诊科室编码'], [isInpatient ? 'admission_time' : 'visit_type', isInpatient ? 'DATETIME' : 'VARCHAR(16)', '是', isInpatient ? '入院时间' : '就诊类型'], [isInpatient ? 'discharge_time' : 'visit_time', 'DATETIME', '否', isInpatient ? '出院时间' : '就诊时间'], ['source_system', 'VARCHAR(32)', '否', '来源系统标识'], ['updated_at', 'DATETIME', '否', '最后更新时间']];
    content = `<p class="subtle" style="margin-bottom:14px">结构元数据 · 7 个示例字段 · 无行级样本</p><div class="mini-table"><table><thead><tr><th>字段名称</th><th>类型</th><th>可空</th><th>业务含义</th></tr></thead><tbody>${fields.map((row) => `<tr>${row.map((value, i) => `<td ${i === 0 ? 'class="sample-id"' : ''}>${value}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  } else if (state.sheetTab === 'quality') {
    content = `<div class="inline-notice">${icon('info')}质量结论来自独立的质量规则运行；目录已摄取不代表质量通过。</div><div class="detail-section"><h3>最近一次评估</h3><div class="mini-table"><table><thead><tr><th>质量规则</th><th>维度</th><th>结论</th></tr></thead><tbody>${[['就诊标识不能为空', '完整性'], ['科室编码符合院级字典', '一致性'], ['就诊时间格式有效', '有效性'], ['就诊记录主键唯一', '唯一性']].map(([name, type], i) => `<tr><td>${name}</td><td>${type}</td><td>${badge(i === 1 && item.quality !== 100 ? '待处理' : '通过', i === 1 && item.quality !== 100 ? 'warn' : 'success')}</td></tr>`).join('')}</tbody></table></div></div>`;
  } else if (state.sheetTab === 'lineage') {
    content = `<div class="inline-notice">${icon('network')}上游是数据来源，下游是产出与消费。此处为合成登记关系。</div><div class="detail-section"><h3>上下游影响链</h3>${flow(item)}<p style="margin-top:16px">下游消费：门诊科室日汇总、门诊运营分析看板。结构变更需先检查下游引用与数据合同。</p></div><div class="detail-section"><h3>关系依据</h3><div class="facts"><div><dt>登记方式</dt><dd>声明式血缘（审核样例）</dd></div><div><dt>最近刷新</dt><dd>2026-11-16 09:30</dd></div></div></div>`;
  } else {
    content = `<div class="inline-notice">${icon('info')}已摄取表示结构元数据已进入目录，不代表数据已采样、质量通过或已认证。</div><div class="detail-section"><h3>业务定义</h3><p>${descriptions[item.name] || `${item.name}相关的标准化数据结构，用于${item.domain}的治理与使用。此内容为审核样例。`}</p></div><dl class="facts" style="margin-top:20px"><div><dt>所属业务域</dt><dd>${item.domain}</dd></div><div><dt>数据分层</dt><dd>${item.layer} · ${item.layer === 'ODS' ? '原始数据层' : '治理与消费层'}</dd></div><div><dt>责任部门</dt><dd>${item.department}</dd></div><div><dt>元数据更新</dt><dd>2026-11-16 09:30</dd></div><div><dt>质量规则通过率</dt><dd>${item.quality === null ? '— 尚未评估' : `${item.quality.toFixed(1)}%`}</dd></div><div><dt>敏感性标记</dt><dd>受控访问 · 无样本展示</dd></div></dl><div class="detail-section"><h3>从来源到使用</h3>${flow(item)}</div>`;
  }
  const body = `<div class="sheet-body" style="padding-bottom:0"><h3 class="sheet-subject">${item.name}</h3><div class="detail-meta"><span class="sample-id">${item.code}</span></div><div class="asset-tagline">${badge(item.domain)}${badge(item.layer)}${badge('结构已摄取', 'blue')}</div></div>${sheetTabs([['overview', '概览'], ['fields', '字段结构'], ['quality', '质量规则'], ['lineage', '血缘与消费']])}<div class="sheet-body">${content}</div>`;
  return sheetFrame('数据资产详情', `${item.id} · 统一资产上下文`, body, `<div class="footer-hint">合成资产，仅供目录与详情交互审核。</div><div class="footer-actions">${action('close-sheet', '关闭')}${action('asset-to-quality', `查看质量问题 ${icon('chevron')}`, '', 'btn primary')}</div>`);
}
function flow(item) {
  const upstream = { 门诊医疗: '门诊 HIS', 住院医疗: '住院 EMR', 药品管理: '药品管理系统', 患者主索引: '多源患者登记' }[item.domain];
  const downstream = { 门诊医疗: '科室日汇总', 住院医疗: '住院主题数据', 药品管理: '用药日汇总', 患者主索引: '归一身份投影' }[item.domain];
  return `<div class="asset-mini-flow"><div class="flow-node"><small>上游来源</small>${upstream}</div>${icon('chevron')}<div class="flow-node active"><small>当前资产</small>${item.name}</div>${icon('chevron')}<div class="flow-node"><small>下游产出</small>${downstream}</div>${icon('chevron')}<div class="flow-node"><small>消费</small>受控数据服务</div></div>`;
}

function taskSheet(item) {
  return sheetFrame('采集任务详情', `${item.id} · 合成配置与运行`, `<div class="sheet-body"><h3 class="sheet-subject">${esc(item.name)}</h3><div class="detail-meta">${badge(item.enabled ? '已启用' : '已暂停', item.enabled ? 'blue' : '')}<span>最近运行：${resultStatus(item.result)}</span></div><dl class="facts"><div><dt>来源系统</dt><dd>${item.source}</dd></div><div><dt>采集模式</dt><dd>${item.mode}采集</dd></div><div><dt>调度周期</dt><dd>${item.frequency}</dd></div><div><dt>执行通道</dt><dd>中心采集执行器</dd></div></dl><div class="detail-section"><h3>最近运行</h3><ol class="timeline"><li><div class="event-title">${item.result === '失败' ? '执行失败，等待排查' : item.result === '未运行' ? '任务尚未触发' : '运行记录已更新'}</div><p>11-16 ${item.updated} · 演示执行批次 RUN-20261116-012</p></li><li><div class="event-title">任务配置已登记</div><p>配置状态与采集结果分开呈现。</p></li></ol></div><div class="detail-section"><h3>配置 JSON <span class="subtle" style="font-weight:400">默认展开</span></h3><label class="form-field"><textarea class="code-editor" aria-label="任务配置 JSON" readonly>${esc(JSON.stringify(item.config || { sourceRef: 'SRC-DEMO-001', target: 'ods_outpatient_visit', mode: item.mode === '全量' ? 'FULL' : 'INCREMENTAL', credentialRef: 'demo-reference-only' }, null, 2))}</textarea></label></div><div class="inline-notice">${icon('info')}凭据引用为审核占位，不包含账号、口令或连接串。</div></div>`, `<div class="footer-hint">演示动作不提交到外部执行器。</div><div class="footer-actions">${action('close-sheet', '关闭')}${action('copy-task', `${icon('copy')} 复制任务`, `data-id="${item.id}"`)}${action('simulate-run', `${icon('play')} 模拟发起运行`, '', 'btn primary')}</div>`);
}
function commandPanel() {
  openModal('跳转到工作区', `<label class="search-field">${icon('search')}<input id="command-search" aria-label="搜索页面" placeholder="搜索页面名称…" autocomplete="off" /></label><div class="command-list">${Object.entries(pageNames).map(([key, name]) => `<button data-command-route="${key}">${icon(pageIcons[key])}${name}<small>进入工作区 ${icon('chevron')}</small></button>`).join('')}</div><p class="subtle" style="margin-top:10px">↑ ↓ 选择页面 · Enter 打开 · Esc 关闭</p>`, true);
}

document.addEventListener('click', (event) => {
  const el = event.target.closest('button');
  if (!el) return;
  if (el.dataset.route) { go(el.dataset.route); return; }
  if (el.dataset.commandRoute) { $('#modal').close(); go(el.dataset.commandRoute); return; }
  const name = el.dataset.action;
  const id = el.dataset.id;
  if (!name) return;
  switch (name) {
    case 'collapse': document.body.classList.toggle('collapsed'); header(); break;
    case 'command': commandPanel(); break;
    case 'close-tab': {
      const key = el.dataset.routeKey; if (state.route === key && patterns.beforeNavigate('overview', key)) return; state.visited = state.visited.filter((value) => value !== key);
      if (state.route === key) go('overview'); else header(); break;
    }
    case 'governance': go('quality'); break;
    case 'goto-quality': go('quality'); break;
    case 'goto-ingestion': go('ingestion'); break;
    case 'planned': planned(el.dataset.label); break;
    case 'close-modal': patterns.requestCloseModal(); break;
    case 'close-sheet': patterns.requestCloseSheet(); break;
    case 'help': openModal('原型审核说明', '<p>本轮覆盖总览、数据接入、数据质量、数据资产，以及对应详情抽屉。</p><p style="margin-top:10px">可试用搜索、筛选、分页、显示列、侧栏收起、顶栏页签与 ⌘ / Ctrl K 跳转。左下角可预览加载、空、失败和待接入状态。</p><p style="margin-top:10px">所有业务数据均为合成样例，操作仅保存在当前页面，刷新可复位。</p>'); break;
    case 'profile': patterns.openQuick('profile', el); break;
    case 'notifications': patterns.openQuick('notifications', el); break;
    case 'date': patterns.openQuick('date', el); break;
    case 'chart-period': state.chartDays = Number(el.dataset.days); render(); break;
    case 'ingestion-tab': state.ingestionTab = el.dataset.value; state.status = ''; state.kind = ''; state.q = ''; state.page = 1; state.selected.clear(); render(); break;
    case 'quality-tab': state.qualityTab = el.dataset.value; state.status = ''; state.kind = ''; state.q = ''; state.page = 1; render(); break;
    case 'quality-rules': go('rules'); break;
    case 'quality-guide': openModal('登记质量问题', `<p>质量事件应关联已知资产、规则和责任部门，以便保留可核验的来源。</p><p style="margin-top:8px">本轮先审核问题队列、证据、责任链与复检反馈。登记流程将在详细设计中展开。</p>`); break;
    case 'source-guide': patterns.openSourceDialog(); break;
    case 'show-sources': $('#modal').close(); state.ingestionTab = 'sources'; state.q = ''; state.status = ''; state.page = 1; render(); break;
    case 'source-detail': { const item = sources.find((value) => value.id === id); openModal(item.name, `<p>编号：${item.id}</p><p>接入方式：${item.type}</p><p>配置状态：${item.checked ? '已检查（合成）' : '待检查'}</p><p style="margin-top:10px">此状态不代表业务数据已读取，也不展示真实端点或凭据。</p>`); break; }
    case 'new-task': go('task-editor'); break;
    case 'copy-task': patterns.openCopyDialog(id); break;
    case 'task-detail': openSheet('task', id); break;
    case 'toggle-task': { const item = tasks.find((value) => value.id === id); item.enabled = !item.enabled; render(); $(`[data-action="toggle-task"][data-id="${id}"]`)?.focus(); toast(`已在原型中${item.enabled ? '启用' : '暂停'}该任务，未修改真实配置。`); break; }
    case 'batch-pause': tasks.forEach((item) => { if (state.selected.has(item.id)) item.enabled = false; }); state.selected.clear(); render(); toast('所选合成任务已暂停；未提交到真实服务。'); break;
    case 'clear-selected': state.selected.clear(); updateTable(); break;
    case 'page': state.page = Number(el.dataset.page); updateTable(); break;
    case 'clear-filters': state.q = ''; state.status = ''; state.kind = ''; state.page = 1; render(); $('#table-search')?.focus(); break;
    case 'refresh': state.preview = 'loading'; render(); setTimeout(() => { state.preview = 'normal'; render(); toast('合成审核数据已重新加载。'); }, 550); break;
    case 'asset-sync': toast('目录样例已刷新；未触发真实元数据摄取。'); break;
    case 'columns': { const panel = $('#columns-popover'); panel.hidden = !panel.hidden; el.setAttribute('aria-expanded', String(!panel.hidden)); break; }
    case 'reset-columns': state.hiddenMode = false; state.hiddenUpdated = false; syncColumnClasses(); all('[data-column]').forEach((checkbox) => { checkbox.checked = true; }); break;
    case 'expand': { const panel = $('#list-surface'); const next = !panel.classList.contains('table-focus'); panel.classList.toggle('table-focus', next); el.setAttribute('aria-pressed', String(next)); el.title = next ? '退出全屏，Esc' : '全屏表格'; break; }
    case 'open-issue': openSheet('issue', id); break;
    case 'open-asset': openSheet('asset', id); break;
    case 'sheet-tab': state.sheetTab = el.dataset.value; renderSheet(); $(`[data-action="sheet-tab"][data-value="${state.sheetTab}"]`, $('#sheet'))?.focus({ preventScroll: true }); break;
    case 'save-note': { const field = $('#issue-note'); if (!field.value.trim()) { field.setAttribute('aria-invalid', 'true'); field.placeholder = '请先填写处理说明'; field.focus(); return; } const item = issues.find((value) => value.id === state.sheet.id); item.notes.unshift(field.value.trim()); state.issueDrafts[item.id] = ''; state.sheetTab = 'records'; renderSheet(); toast('处理说明已保存在当前原型的合成事件中。'); break; }
    case 'remind': toast('提醒已进入演示发件箱，投递结果待回执。'); break;
    case 'recheck': { const item = issues.find((value) => value.id === state.sheet.id); if (item.stage !== 'OPEN') return; item.stage = 'RECHECKING'; item.requested = true; state.sheetTab = 'evidence'; render(); renderSheet(); toast('复检请求已登记；等待异步结果，不代表校验通过。'); break; }
    case 'simulate-run': { const item = tasks.find((value) => value.id === state.sheet.id); item.result = '运行中'; renderSheet(); toast('演示运行已登记；未向外部执行器发送请求。'); updateTable(); break; }
    case 'asset-to-quality': { const asset = assets.find((item) => item.id === state.sheet.id); $('#sheet').close(); go('quality'); state.q = asset.name; render(); break; }
    case 'asset-category': state.category = el.dataset.value; state.page = 1; render(); break;
    case 'restore-preview': state.preview = 'normal'; render(); break;
    case 'pending-guide': openModal('接入前准备', '<p>确认数据源与责任部门 → 登记受控连接引用 → 检查连通性 → 创建采集任务 → 验证运行与业务结果。</p><p style="margin-top:10px">待接入状态不会用合成数据补位。本轮可切换左下角「有数据」继续审核。</p>'); break;
    case 'export': { const content = '\ufeff资产名称,表名,业务域,责任部门\n' + assets.map((item) => [item.name, item.code, item.domain, item.department].join(',')).join('\n'); const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = '医数中枢-合成资产目录.csv'; link.click(); URL.revokeObjectURL(url); toast('已导出合成资产目录，仅用于原型审核。'); break; }
  }
});

document.addEventListener('input', (event) => {
  if (event.target.id === 'issue-note' && state.sheet) state.issueDrafts[state.sheet.id] = event.target.value;
  if (event.target.id === 'table-search') { state.q = event.target.value; state.page = 1; updateTable(); }
  if (event.target.id === 'command-search') {
    const value = event.target.value.toLowerCase();
    all('[data-command-route]').forEach((button) => { button.hidden = !pageNames[button.dataset.commandRoute].toLowerCase().includes(value); button.style.display = button.hidden ? 'none' : ''; });
  }
});
document.addEventListener('change', (event) => {
  const target = event.target;
  if (target.id === 'preview-state') { state.preview = target.value; render(); }
  if (target.dataset.filter) { state[target.dataset.filter] = target.value; state.page = 1; updateTable(); }
  if (target.dataset.select) { if (target.checked) state.selected.add(target.dataset.select); else state.selected.delete(target.dataset.select); updateTable(); }
  if (target.id === 'select-all') { all('[data-select]').forEach((input) => { if (target.checked) state.selected.add(input.dataset.select); else state.selected.delete(input.dataset.select); }); updateTable(); }
  if (target.dataset.column) { if (target.dataset.column === 'mode') state.hiddenMode = !target.checked; else state.hiddenUpdated = !target.checked; syncColumnClasses(); }
});
document.addEventListener('keydown', (event) => {
  const activeDialog = $('#modal').open ? $('#modal') : $('#sheet').open ? $('#sheet') : null;
  if (event.key === 'Tab' && activeDialog) {
    const controls = all('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]', activeDialog).filter((node) => node.getClientRects().length > 0);
    const first = controls[0];
    const last = controls.at(-1);
    const outside = !activeDialog.contains(document.activeElement);
    if (event.shiftKey && (document.activeElement === first || outside)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || outside)) { event.preventDefault(); first?.focus(); }
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); if (!$('#sheet').open && !$('#modal').open) commandPanel(); }
  if (event.key === 'Escape') { $('#list-surface')?.classList.remove('table-focus'); $('[data-action="expand"]')?.setAttribute('aria-pressed', 'false'); $('#columns-popover')?.setAttribute('hidden', ''); $('[data-action="columns"]')?.setAttribute('aria-expanded', 'false'); }
  if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) && event.target.getAttribute('role') === 'tab') {
    const tabs = all('[role="tab"]', event.target.closest('[role="tablist"]'));
    const current = tabs.indexOf(event.target);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    const target = tabs[next];
    const value = target.dataset.value;
    const eventName = target.dataset.action;
    event.preventDefault(); target.click();
    $(`[data-action="${eventName}"][data-value="${value}"]`)?.focus({ preventScroll: true });
  }
  if ($('#modal').open && $('#modal').classList.contains('command')) {
    const entries = all('[data-command-route]').filter((button) => !button.hidden);
    const position = entries.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const delta = event.key === 'ArrowDown' ? 1 : -1; const next = position < 0 ? (delta > 0 ? 0 : entries.length - 1) : (position + delta + entries.length) % entries.length; entries[next]?.focus(); }
    if (event.key === 'Enter' && document.activeElement.id === 'command-search' && entries[0]) { event.preventDefault(); entries[0].click(); }
  }
});
document.addEventListener('click', (event) => {
  if (!event.target.closest('.popover-anchor')) { const panel = $('#columns-popover'); if (panel) panel.hidden = true; $('[data-action="columns"]')?.setAttribute('aria-expanded', 'false'); }
});
$('#sheet').addEventListener('close', () => { const selector = state.restoreSelector; state.sheet = null; requestAnimationFrame(() => ($(selector || '[data-action="new-task"]') || $('#main'))?.focus({ preventScroll: true })); });
const patterns = mountInteractionPatterns({ state, tasks, sources, sourceNames, icon, esc, badge, go, render, toast, openModal });
window.addEventListener('hashchange', () => go(routeFromHash()));
render();
