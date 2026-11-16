// 容器按操作目的选择：短表单、后果确认、长任务、详情与轻量浮层分别承担职责。
export function mountInteractionPatterns(api) {
  const { state, tasks, sources, sourceNames, icon, esc, badge, go, render, toast, openModal } = api;
  const find = (selector, root = document) => root.querySelector(selector);
  const many = (selector, root = document) => [...root.querySelectorAll(selector)];
  const button = (event, label, tone = '', extra = '') => `<button type="button" class="btn ${tone}" data-pattern="${event}" ${extra}>${label}</button>`;
  const modal = find('#modal');
  const sheet = find('#sheet');
  const confirm = document.createElement('dialog');
  confirm.id = 'confirm'; confirm.className = 'modal confirm-modal';
  confirm.setAttribute('role', 'alertdialog'); confirm.setAttribute('aria-modal', 'true');
  confirm.setAttribute('aria-labelledby', 'confirm-title'); confirm.setAttribute('aria-describedby', 'confirm-description');
  document.body.append(confirm);
  const quick = document.createElement('div');
  quick.id = 'quick-popover'; quick.className = 'quick-popover'; quick.setAttribute('popover', 'auto');
  document.body.append(quick);
  let formBaseline = null;
  let editorBaseline = null;
  let modalMode = null;
  let pendingConfirm = null;
  let busy = false;
  let allowNavigation = false;
  let focusSelector = null;
  const serialize = (form) => form ? JSON.stringify([...new FormData(form).entries()]) : '';
  const editorDirty = () => Boolean(find('#task-editor-form') && editorBaseline !== null && serialize(find('#task-editor-form')) !== editorBaseline);
  const modalDirty = () => Boolean(modalMode && serialize(find('#compact-form')) !== formBaseline);
  const sheetDirty = () => Boolean((find('#issue-note', sheet)?.value || state.issueDrafts[state.sheet?.id] || '').trim());
  const rules = [
    ['RULE-DRUG-004', '院级药品编码一致性', '一致性', '门诊处方明细', false],
    ['RULE-VISIT-002', '就诊标识完整性', '完整性', '门诊就诊记录', true],
    ['RULE-RX-003', '处方明细主键唯一', '唯一性', '门诊处方明细', false],
    ['RULE-TIME-001', '住院时间逻辑校验', '准确性', '住院病历记录', false],
    ['RULE-DICT-001', '院级字典枚举有效', '有效性', '科室标准字典', true],
    ['RULE-LINK-001', '处方就诊关联完整', '关联性', '门诊处方主表', true],
  ].map(([id, name, dimension, asset, builtin]) => ({ id, name, dimension, asset, builtin }));

  function focusBack() {
    requestAnimationFrame(() => (find(focusSelector || '[data-action="source-guide"]') || find('#main')).focus({ preventScroll: true }));
  }
  function prepareModal() {
    modal.classList.remove('form-modal'); modal.removeAttribute('aria-busy');
    modalMode = null; formBaseline = null;
  }
  function protectClose(container, target) {
    if (find('.discard-inline', container)) return;
    const footer = find('.compact-footer', container) || find('.sheet-footer', container);
    const notice = document.createElement('div');
    notice.className = 'discard-inline'; notice.setAttribute('role', 'alert');
    notice.innerHTML = `<p>有未保存的内容。关闭后将丢弃本次修改。</p><div>${button(`continue-${target}`, '继续编辑')}${button(`discard-${target}`, '放弃更改并关闭', 'danger-outline')}</div>`;
    footer.prepend(notice);
    find(`[data-pattern="continue-${target}"]`, notice).focus();
  }
  function requestCloseModal() {
    if (busy) return;
    if (modalDirty()) protectClose(modal, 'modal'); else modal.close();
  }
  function requestCloseSheet() {
    if (sheetDirty()) protectClose(sheet, 'sheet'); else sheet.close();
  }
  function openForm(title, description, fields, submitText, mode) {
    if (sheet.open) sheet.close();
    openModal(title, `<p class="compact-description">${description}</p><form id="compact-form">${fields}<p class="form-error" id="compact-error" role="alert"></p></form><footer class="compact-footer"><span class="compact-note">审核原型 · 合成数据</span><div class="compact-actions">${button('cancel-modal', '取消')}<button class="btn primary" type="submit" form="compact-form">${submitText}</button></div></footer>`);
    modal.classList.add('form-modal'); modalMode = mode;
    formBaseline = serialize(find('#compact-form'));
    find('input', modal)?.focus();
  }
  function openSourceDialog() {
    focusSelector = '[data-action="source-guide"]';
    openForm('登记数据源', '登记来源后进入待检查状态，不会立即读取院内数据。', `<label class="form-field"><span>来源名称 <em>*</em></span><input name="name" required maxlength="60" placeholder="例如：检验前置机" /></label><div class="form-grid"><label class="form-field"><span>系统类型</span><select name="systemType"><option>LIS</option><option>EMR</option><option>HIS</option><option>PACS</option></select></label><label class="form-field"><span>接入协议</span><select name="protocol"><option>JDBC</option><option>HTTP</option><option>FHIR</option><option>SFTP</option></select></label></div><div class="inline-notice">${icon('info')}连接信息在后续检查中配置；此处只登记数据源身份。</div>`, '登记来源', 'source');
  }
  function openCopyDialog(id) {
    const task = tasks.find((item) => item.id === id);
    focusSelector = `[data-action="task-detail"][data-id="${id}"]`;
    openForm('复制采集任务', `基于「${esc(task.name)}」创建草稿，运行状态与历史记录不复制。`, `<label class="form-field"><span>副本名称 <em>*</em></span><input name="name" required maxlength="60" value="${esc(task.name)} · 副本" /></label><label class="form-field"><span>目标数据源</span><select name="source">${sources.map((item) => `<option ${item.name === task.source ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select></label>`, '创建副本', { type: 'copy', task });
  }
  function openConfirm(config) {
    if (confirm.open) return;
    pendingConfirm = config;
    confirm.innerHTML = `<div class="confirm-body"><span class="confirm-icon ${config.danger ? 'destructive' : ''}">${icon(config.danger ? 'alert' : 'file')}</span><h2 id="confirm-title">${config.title}</h2><p id="confirm-description">${config.description}</p>${config.object ? `<div class="confirm-object">${config.object}</div>` : ''}${config.hint ? `<p class="confirm-hint">${config.hint}</p>` : ''}<p id="confirm-error" class="form-error" role="alert"></p></div><footer class="confirm-footer">${button('cancel-confirm', config.cancel || '取消')} ${button('accept-confirm', config.accept, config.danger ? 'danger' : 'primary')}</footer>`;
    confirm.showModal(); find('[data-pattern="cancel-confirm"]', confirm).focus();
  }
  function beforeNavigate(route, closeTab = null) {
    if (busy) return true;
    if (allowNavigation) { allowNavigation = false; return false; }
    if (state.route !== 'task-editor' || !editorDirty() || route === 'task-editor') return false;
    history.replaceState(null, '', '#task-editor');
    focusSelector = '#task-editor-form [name="name"]';
    openConfirm({ title: '放弃未保存的任务？', description: '当前任务尚未保存为草稿。离开后，本次输入和配置修改将丢失。', accept: '放弃并离开', cancel: '继续编辑', execute: () => { if (closeTab) state.visited = state.visited.filter((key) => key !== closeTab); allowNavigation = true; go(route); }, immediate: true });
    return true;
  }
  function heading(route) {
    const editor = route === 'task-editor';
    return `<div class="breadcrumb">${icon('home')}<span>${editor ? '数据管理' : '数据治理'}</span>${icon('chevron')}<button class="breadcrumb-link" data-route="${editor ? 'ingestion' : 'quality'}">${editor ? '数据接入' : '数据质量'}</button>${icon('chevron')}<span class="last">${editor ? '新建采集任务' : '规则目录'}</span><div class="review-mark"><span>设计审核 v0.2</span>全部为合成数据</div></div><div class="page-heading"><div><h1>${editor ? '新建采集任务' : '质量规则目录'}</h1><p class="page-description">${editor ? '在完整工作区核对来源、采集策略、目标与配置。' : '统一查阅质量规则；删除与历史记录保留分别说明。'}</p></div><div class="heading-actions">${editor ? `${button('cancel-editor', '取消')}<button class="btn primary" type="submit" form="task-editor-form">${icon('check')} 保存演示草稿</button>` : `<button class="btn" data-route="quality">${icon('arrowleft')} 返回问题列表</button>`}</div></div>`;
  }
  function taskEditor() {
    return `<form id="task-editor-form" class="surface task-editor"><header class="editor-banner"><div>${badge('草稿')}<span>来源与采集策略</span>${icon('chevron')}<span>目标与配置</span>${icon('chevron')}<span>检查后保存</span></div><span class="subtle">配置保存后仍需单独启动采集</span></header><div class="editor-grid"><section class="editor-section"><h2>基本信息</h2><p class="editor-description">明确任务名称，选择已登记的数据来源。</p><label class="form-field"><span>任务名称 <em>*</em></span><input name="name" required maxlength="60" placeholder="例如：门诊诊断信息增量采集" /></label><div class="form-grid"><label class="form-field"><span>数据来源 <em>*</em></span><select name="source">${sources.map((item) => `<option>${esc(item.name)}</option>`).join('')}</select></label><label class="form-field"><span>采集模式</span><select name="mode"><option>增量</option><option>全量</option></select></label></div><h2 class="section-break">采集策略</h2><p class="editor-description">调度、增量字段与初始水位需与来源范围一致。</p><label class="form-field"><span>调度周期</span><select name="frequency"><option>每 15 分钟</option><option>每 30 分钟</option><option>每日 02:00</option><option>手动触发</option></select></label><div class="form-grid"><label class="form-field"><span>增量字段</span><select name="watermarkField"><option>updated_at</option><option>id</option></select></label><label class="form-field"><span>初始水位</span><input name="watermark" value="2026-11-16 00:00:00" /></label></div><div class="inline-notice">${icon('info')}保存草稿只登记配置。来源连通性、运行完成和入仓结果分别验证。</div></section><section class="editor-section editor-config"><h2>目标与配置</h2><p class="editor-description">配置 JSON 默认展开，可与来源和增量策略反复核对。</p><label class="form-field"><span>配置 JSON <em>*</em><span class="subtle" style="margin-left:8px">可编辑</span></span><textarea name="config" class="code-editor" required aria-label="配置 JSON">${esc(JSON.stringify({ sourceRef: 'SRC-DEMO-001', target: 'ods_outpatient_diagnosis', mode: 'INCREMENTAL', watermark: { field: 'updated_at', initial: '2026-11-16 00:00:00' }, credentialRef: 'demo-reference-only' }, null, 2))}</textarea><div class="form-hint">凭据以引用方式配置，不填写明文账号或口令。</div></label><p class="form-error" id="editor-error" role="alert"></p><div class="editor-check"><h3>保存前核对</h3><p>${icon('check')} 数据范围与增量方式一致</p><p>${icon('check')} JSON 格式有效，配置可追溯</p><p>${icon('info')} 草稿不触发采集，不推进业务位点</p></div></section></div><footer class="editor-footer"><span>${icon('info')}审核原型仅保存本地合成草稿，刷新可复位。</span><button type="button" class="text-btn" data-pattern="cancel-editor">返回采集任务</button></footer></form>`;
  }
  function rulePage() {
    return `<section class="surface"><div class="surface-head"><div><h2>质量规则<span class="count">${rules.length}</span></h2><p>自定义规则可删除；已产生的问题与运行记录继续保留。</p></div><span class="subtle">审核目录 · 合成规则</span></div><div class="table-wrap"><table><thead><tr><th>规则名称 / 编号</th><th>质量维度</th><th>关联资产</th><th>来源</th><th>状态</th><th>操作</th></tr></thead><tbody>${rules.map((rule) => `<tr><td><div class="cell-title">${rule.name}</div><div class="cell-meta">${rule.id}</div></td><td>${rule.dimension}</td><td>${rule.asset}</td><td>${rule.builtin ? '内置规则' : '自定义规则'}</td><td>${badge('已登记')}</td><td>${rule.builtin ? '<span class="subtle">内置规则保留</span>' : `<button class="text-btn danger-text" data-pattern="delete-rule" data-id="${rule.id}">删除</button>`}</td></tr>`).join('')}</tbody></table></div><div class="pagination"><span>共 ${rules.length} 条规则</span><span>规则编辑将在完整工作页展开</span></div></section>`;
  }
  function content(route) { return route === 'task-editor' ? taskEditor() : rulePage(); }
  function afterRender() {
    const form = find('#task-editor-form');
    if (form) { editorBaseline = serialize(form); find('#preview-state').disabled = true; }
    else editorBaseline = null;
  }

  function openQuick(type, anchor) {
    if (quick.matches(':popover-open')) quick.hidePopover();
    const content = {
      profile: '<h3>张文博</h3><p>信息中心 · 原型审核员</p><div class="quick-separator"></div><p class="subtle">合成审核身份，不代表真实登录状态。</p>',
      notifications: '<h3>通知中心</h3><p><strong>质量问题等待处理</strong><br>药品编码未匹配院级标准 · 合成通知</p><div class="quick-separator"></div><p><strong>提醒已进入演示发件箱</strong><br>投递结果待回执，不代表责任人已收到。</p>',
      date: `<h3>查看时间范围</h3><p>选择趋势图展示周期</p><div class="quick-ranges">${button('range-7', '最近 7 天')}${button('range-30', '最近 30 天')}</div>`,
    }[type];
    quick.innerHTML = content;
    const box = anchor.getBoundingClientRect();
    quick.style.top = `${box.bottom + 8}px`;
    quick.style.left = `${Math.max(12, Math.min(box.right - 290, innerWidth - 305))}px`;
    quick.showPopover();
  }

  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-pattern]'); if (!target) return;
    const type = target.dataset.pattern;
    if (type === 'cancel-modal') requestCloseModal();
    if (type === 'continue-modal' || type === 'continue-sheet') { target.closest('.discard-inline').remove(); if (type === 'continue-sheet' && !find('#issue-note')) find('[data-action="sheet-tab"][data-value="evidence"]').click(); (find('#compact-form input') || find('#issue-note'))?.focus(); }
    if (type === 'discard-modal') modal.close();
    if (type === 'discard-sheet') { state.issueDrafts[state.sheet.id] = ''; if (find('#issue-note')) find('#issue-note').value = ''; sheet.close(); }
    if (type === 'cancel-editor') go('ingestion');
    if (type === 'cancel-confirm' && !busy) confirm.close();
    if (type === 'range-7' || type === 'range-30') { state.chartDays = type === 'range-7' ? 7 : 30; quick.hidePopover(); render(); }
    if (type === 'delete-rule') {
      const rule = rules.find((item) => item.id === target.dataset.id);
      focusSelector = `[data-pattern="delete-rule"][data-id="${rule.id}"]`;
      openConfirm({ title: '删除这条质量规则？', danger: true, description: '规则将从目录删除，并从质量检查服务摘除。已有治理问题与运行记录继续保留。', object: `<strong>${rule.name}</strong><span class="sample-id">${rule.id}</span><span>${rule.dimension} · ${rule.asset}</span>`, hint: '此操作不可撤销。如只需临时停止使用，请选择停用。', accept: '删除规则', execute: () => { rules.splice(rules.indexOf(rule), 1); render(); toast('合成规则已删除；历史问题与运行样例继续保留。'); } });
    }
    if (type === 'accept-confirm' && !busy) {
      const config = pendingConfirm;
      const finish = () => { try { config.execute(); confirm.close(); } catch (error) { find('#confirm-error').textContent = error.message; } finally { busy = false; confirm.removeAttribute('aria-busy'); many('button', confirm).forEach((node) => { node.disabled = false; }); } };
      if (config.immediate) { finish(); return; }
      busy = true; confirm.setAttribute('aria-busy', 'true'); many('button', confirm).forEach((node) => { node.disabled = true; }); target.textContent = '正在删除…'; setTimeout(finish, 450);
    }
  });
  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!['compact-form', 'task-editor-form'].includes(form.id)) return;
    event.preventDefault(); if (busy) return;
    const values = Object.fromEntries(new FormData(form));
    const isEditor = form.id === 'task-editor-form';
    const errorNode = find(isEditor ? '#editor-error' : '#compact-error');
    errorNode.textContent = '';
    let config;
    if (isEditor) {
      try { config = JSON.parse(values.config); if (!config || Array.isArray(config) || typeof config !== 'object') throw new Error(); }
      catch { errorNode.textContent = '配置 JSON 格式不正确，请填写有效对象后重试。'; find('[name="config"]').focus(); return; }
    }
    const mode = modalMode;
    const name = values.name.trim();
    if (!name) { find('[name="name"]', form).focus(); return; }
    const controls = isEditor ? many('input, select, textarea, button[form="task-editor-form"], [data-pattern="cancel-editor"]') : many('input, select, button', modal);
    const submit = find(isEditor ? '[form="task-editor-form"]' : '[form="compact-form"]');
    const previousText = submit.innerHTML;
    busy = true; form.setAttribute('aria-busy', 'true'); modal.setAttribute('aria-busy', 'true');
    controls.forEach((node) => { node.disabled = true; }); submit.textContent = '正在保存…';
    setTimeout(() => {
      try {
        if (!isEditor && mode === 'source') {
          if (sources.some((item) => item.name === name)) throw new Error('来源名称已存在，请修改名称后重试。');
          sources.unshift({ id: `SRC-DEMO-${sources.length + 1}`, name, systemType: values.systemType, protocol: values.protocol, type: { JDBC: '关系型数据库', HTTP: '标准接口', FHIR: '标准接口', SFTP: '文件交换' }[values.protocol], department: '信息中心', checked: false, updated: '刚刚' });
          sourceNames.push(name); state.ingestionTab = 'sources'; state.q = ''; state.status = ''; state.page = 1;
        } else {
          const original = !isEditor ? mode.task : null;
          tasks.unshift({ ...(original || {}), id: `COL-DEMO-${tasks.length + 1}`, name, source: values.source, mode: values.mode || original.mode, frequency: values.frequency || original.frequency, enabled: false, result: '未运行', updated: '刚刚', config: config || original.config });
          state.ingestionTab = 'tasks';
        }
        busy = false;
        if (isEditor) { editorBaseline = serialize(form); allowNavigation = true; go('ingestion'); }
        else { modal.close(); render(); }
        toast(isEditor ? '已保存本地演示草稿；没有启动采集。' : mode === 'source' ? '来源已登记为待检查；尚未读取院内数据。' : '已创建合成副本；不包含运行历史。');
      } catch (error) { errorNode.textContent = error.message; }
      finally { busy = false; form.removeAttribute('aria-busy'); modal.removeAttribute('aria-busy'); controls.forEach((node) => { node.disabled = false; }); submit.innerHTML = previousText; }
    }, 450);
  });
  modal.addEventListener('cancel', (event) => { if (busy || modalDirty()) { event.preventDefault(); if (!busy) protectClose(modal, 'modal'); } });
  sheet.addEventListener('cancel', (event) => { if (sheetDirty()) { event.preventDefault(); protectClose(sheet, 'sheet'); } });
  modal.addEventListener('close', () => { const managed = modalMode; prepareModal(); if (managed) focusBack(); });
  confirm.addEventListener('cancel', (event) => { if (busy) event.preventDefault(); });
  confirm.addEventListener('close', () => { pendingConfirm = null; focusBack(); });
  document.addEventListener('keydown', (event) => {
    if (!confirm.open) return;
    if (event.key === 'Tab') {
      const controls = many('button:not(:disabled)', confirm);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || !confirm.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !confirm.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  return { heading, content, afterRender, beforeNavigate, openSourceDialog, openCopyDialog, requestCloseModal, requestCloseSheet, prepareModal, openQuick };
}
