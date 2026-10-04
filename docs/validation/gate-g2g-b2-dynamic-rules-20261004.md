# Gate · G2G 批次 2 首刀：质量规则动态化（8 类单表谓词）

- 日期：2026-10-04
- 依据：[g2g-batch2-quality-rules-plan-20261004.md](../g2g-batch2-quality-rules-plan-20261004.md) 首刀设计
- 结果：**通过**（runner 45/45、control-plane 全量零回归 + 6 项新契约测试、前端链全绿、浏览器核验通过）

## 交付范围

### 映射裁决落地

- **生成物 = dbt singular test**：动态规则编译为 `tests/dynamic/<selector>.sql`（返回失败行的 SELECT，Doris 方言），与静态 generic test 同走 `dbt test --select <selector> --store-failures`——执行、进程监督、失败表证据、复检外部运行生命周期**零改动**复用。
- **属主不变**：registry 与 dbt 工程归 runner。控制面 V24 `quality_rule_definitions` 只做定义台账与审计；保存/启停推送 runner（`PUT/DELETE /api/v1/quality/rules/dynamic/{id}`，scope `quality:admin`），runner 校验+生成 SQL+upsert registry（与 rules.yml 静态规则同表同通道）。
- **证据契约按失败表形状对齐**：UNIQUE/VAL_SET 编译为 `(值, n_records)` 聚合（kind=unique/accepted_values）、FK_REF 为孤儿单列（kind=relationships）、其余整行按白名单投影（kind=not_null）——evidence.py 投影与脱敏零改动。

### 首刀 8 类规则（nema RuleType 对应）

| data-os 类型 | nema 编号 | 参数 |
| --- | --- | --- |
| NOT_NULL | 102 填充率 | checkBlank（空串也算失败） |
| UNIQUE | 101 唯一性 | — |
| FK_REF | 103 父子参照 | refDataset（库.表）+ refColumn |
| VAL_SET | 305 值范围 | values（数字自动识别，字符串转义防注入） |
| VAL_MINMAX | 301 最大最小值 | minVal/maxVal 至少一项 |
| VAL_LEN | 302 最大最小长度 | minLen/maxLen 至少一项 |
| STR_REGEX | 304 正则表达式 | regex（单引号转义） |
| SQL | 402 自定义 SQL | 单条只读 SELECT（返回失败行；对 nema totalNum/matchNum 双 SQL 的有意简化，语义可等价表达） |

### 组件

- **quality-runner**：`app/rulegen.py`（DynamicRuleSpec 校验 + 编译器 + 只读 SQL 校验）、`rules_router`（PUT/DELETE，OIDC quality:admin）、`db.disable_rule`（幂等下线）、dev 直通 principal 增 quality:admin。
- **control-plane**：V24 台账（rule_id 主键 + params/evidence JSON + 启停）、`QualityRuleAdminController`（types 目录/CRUD/启停）、`QualityRuleAdminService`（形状校验 + 推送事务内——runner 拒绝即本地回滚，两侧无半份状态）、`DynamicRulePushClient`（复用质量执行器连接与 OIDC 形态，admin-scopes 配置）。
- **portal**：`QualityRulesAdmin` 组件挂质量问题工作台底部——规则列表（类型/维度/启停）+ 新建/编辑抽屉（类型驱动的参数表单 + 证据列白名单编辑器）。

## 测试证据

- runner `test_rulegen.py`（8 项）：八类 SQL 快照（含 checkBlank/单侧边界）、证据契约形状、selector 规范化、注入与误用负向（库表/列标识符、写语句、多语句、注释绕过、空值集、缺边界、空证据列、值集引号转义）、API 写文件+落 registry、下线删文件+registry 禁用+重复 404、坏载荷 400。
- control-plane `QualityRuleAdminApiTest`（6 项，stub runner + DynamicPropertySource）：类型目录 8 项、保存本地落账+推送完整定义、**runner 拒绝回滚台账**（400 detail 透传 + 本地零行）、不支持类型前置拒绝、启停往返经 runner、删除 204 + 台账清零 + 再停 404、列表含 params/evidence。全量 `mvn test` BUILD SUCCESS 零回归。
- 前端：tsc + vitest 28/28 + mock-audit + portal-interactions-smoke + build 全绿。
- 浏览器核验（mock v3）：规则面板挂载与种子行、新建 VAL_MINMAX（参数+双证据列）→列表、停用/启用往返、编辑回填（编号锁定、minVal 回显）、删除消失、SQL 类型表单路径；视觉合格（双列网格/textarea/证据列行内组合截图核验）。

## 边界与坑（记 backlog）

1. **第二刀 8 类未含**：CROSS_VAL_COMPARE/STAT_VAL_COMPARE/SQL_STAT_VAL/DETAIL_STAT/FIELD_LOGIC/UPDATE_TIME/TIME_CONTINUITY + VAL_SET 字典引用（标准中心值域）。
2. **目标域 = Doris 业务库表**（dbt 只读账号面）：nema 的任意 JPA 数据源目标不在本批；dataset 库为字面量（dev/prod 同名约定）。
3. **推送在事务内**：极端场景（推送成功后本地提交前崩溃）runner 残留孤儿规则，同 rule_id 再保存收敛；无补偿协议。
4. **dev Keycloak 需为 dataos 控制面 client 增加 quality:admin scope**（部署侧动作，dev 未配前生产式 OIDC 链会 403）。
5. 整行形状规则的证据白名单列若不存在于目标表，dbt 以 error（非 fail）呈现——消息如实透传，不做预检。
6. 测试坑两条：sqlite 挂 `ATTACH data_os` 才能建带前缀表（CREATE INDEX/ADD COLUMN IF NOT EXISTS 不支持须跳过）；`disable_rule` 须按 enabled=TRUE 收窄否则幂等 404 判定失效。

## 第二刀预告

8 类跨表/统计/时间宏编译 + VAL_SET 接标准中心字典 + nema Dimension 维度归属入治理展示（评分模型平移是批次 3 的输入）。
