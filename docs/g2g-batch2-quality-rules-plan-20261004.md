# G2G 批次 2 · 质量规则动态化 + 16 类规则移植（规划，2026-10-04）

> **进度（2026-10-04）**：首刀已交付并过 gate——8 类单表谓词（NOT_NULL/UNIQUE/VAL_SET/VAL_MINMAX/VAL_LEN/STR_REGEX/FK_REF/SQL）动态配置全链：V24 台账 + runner rulegen 编译器（dbt singular test）+ 推送 + 门户管理面。契约与浏览器核验见 [docs/validation/gate-g2g-b2-dynamic-rules-20261004.md](validation/gate-g2g-b2-dynamic-rules-20261004.md)；五项边界（第二刀 8 类/目标域限 Doris/推送事务语义/dev Keycloak admin scope/白名单列无预检）已记备忘账。**下一刀：8 类跨表/统计/时间宏。**

> 依据：nema 仓库 `docs/design/nema-vs-dataos-coverage-matrix.md` §G2G 批次 2 + 缺口 #1（后端最大缺口，3-4 周级）。参考物：`dqp-common/quality/rule/`（RuleType 16 类 + impl 配置形态 + Dimension 六维）。

## 勘察结论（两端现状）

### data-os 已有（可复用）

- 执行链完整：控制面 `quality` 域（registry 读模型 + 复检外部运行生命周期）→ quality-runner（API 排队 + supervisor 进程监督 + DbtEngine `dbt test --select <selector> --store-failures`）→ 证据投影（evidence.py：失败表形状 × 列白名单 × 脱敏分类）。
- 注册表通道：`rules.yml` → runner 启动 upsert → `data_os.quality_rule_registry`（runner 属主）→ 控制面只读（`findEnabledRules`）。
- OIDC 服务间认证（`data-os.quality.*` 配置 + OidcClientCredentialsTokenProvider）可直接复用于新管理端点。

### 缺口（=本批要补）

- **规则语义静态**：谓词/值域/外键目标手写在 `quality/dbt/models/*.yml`（sources.yml 533 行，~100 条规则），用户不能在门户配置规则——nema 的规则是 UI 配置（选表/列/参数）的动态规则。
- 16 类规则只覆盖 4 类语义（not_null/unique/accepted_values/relationships）。

### nema 参考物（语义库，不搬代码）

- `RuleType`：完整性 101 唯一/102 填充率/103 父子参照；一致性 202 跨表值比较/203 统计值比较/204 SQL 统计比较/205 明细汇总；规范性 301 最大最小值/302 长度/304 正则/305 值范围；准确性 401 字段间关系/402 自定义 SQL；及时性 501 更新率；时间连续性 601。配置形态 = 目标表/字段 + 类型参数（minVal/maxVal、minLen/maxLen、regex、values、threshold+timeUnit、logic 表达式、totalNum/matchNum SQL 等）。

## 映射裁决

1. **生成物 = dbt singular test**：动态规则的谓词语义编译为 `tests/dynamic/<selector>.sql`（返回失败行的 SELECT，Doris 方言），与既有 generic test 同走 `dbt test --select <selector> --store-failures`——执行/监督/证据/复检链零改动。
2. **属主不变**：registry 与 dbt 工程归 runner。控制面新增定义台账（V24 `data_os.quality_rule_definitions`：类型+dataset+列+参数+证据列契约+启停），保存/启停时把完整定义**推送 runner**（`PUT /api/rules/dynamic`）；runner 校验、生成 SQL 文件、upsert registry（与 rules.yml 静态规则同表同通道）。禁用即删 SQL 文件 + registry enabled=FALSE。
3. **目标域 = Doris 业务库表**：dataset_id 沿用「库.表」形态（资产面直接匹配）；nema 的任意 JPA 数据源目标不在本批（记录边界）。
4. **证据契约按失败表形状对齐**：unique/val_set 生成 `(值, n_records)` 聚合形状（kind=unique/accepted_values）；fk_ref 生成孤儿单列（kind=relationships）；其余整行（kind=not_null 投影）。
5. **自定义 SQL 形态简化**：nema 的 totalNum/matchNum 双 SQL + 匹配模式简化为「单条返回失败行的只读 SELECT」（语义可等价表达），单语句/只读校验在 runner 侧强制。
6. **16 类分两刀**：首刀 8 类单表谓词（NOT_NULL/UNIQUE/VAL_SET/VAL_MINMAX/VAL_LEN/STR_REGEX/FK_REF/SQL）；第二刀 8 类跨表/统计/时间宏（CROSS_VAL_COMPARE/STAT_VAL_COMPARE/SQL_STAT_VAL/DETAIL_STAT/FIELD_LOGIC/UPDATE_TIME/TIME_CONTINUITY/VAL_SET-字典引用接标准中心）。

## 首刀实施设计

### quality-runner

- `app/rulegen.py`：`DynamicRuleSpec`（rule_id/type/dataset(库.表)/column/参数/证据列）→ 失败 SQL 编译器；标识符白名单校验（复用 rules.py 口径）+ SQL 类只读单语句校验 + 正则参数引号转义。
- `PUT /api/rules/dynamic` / `DELETE /api/rules/dynamic/{ruleId}`：校验 → 写 `tests/dynamic/<selector>.sql` → upsert registry（evidence 契约由 spec 派生）；OIDC scope `quality:admin`（新增）。
- selector 派生：`dynamic_<rule_id 规范化>`，与静态规则命名空间隔离。

### control-plane

- V24：`data_os.quality_rule_definitions`（rule_id PK / type / dataset_id / column / params_json / evidence_json / enabled / created_at / updated_at）。
- `QualityRuleAdminController`：CRUD + 启停；保存/启停时经 runner HTTP client 推送（失败如实回 502 语义，不半更新）。
- 复检链零改动：`findEnabledRules` 已按 dataset 读 registry，动态规则落 registry 后自动进入资产质量面与复检。

### portal

- 质量规则管理面：规则列表（类型/维度徽标/启停）+ 新建/编辑抽屉（类型选择 → 参数表单按类型渲染 + 证据列白名单编辑）。挂在质量问题工作台入口。

### 验收

- runner：rulegen 单测（8 类 SQL 快照 + 注入负向）+ API 集成测（sqlite 侧 registry 落库）；`cd services/quality-runner && .venv/bin/python -m pytest tests/ -q`。
- control-plane：契约测试（CRUD/推送 mock/启停/推送失败原子性）；`mvn test` 全绿零回归。
- portal：tsc + vitest + qa 链 + build；浏览器核验建规则→列表→启停。

## 第二刀预告

8 类跨表/统计/时间宏 + VAL_SET 字典引用接标准中心 + nema Dimension 维度归属入证据展示。
