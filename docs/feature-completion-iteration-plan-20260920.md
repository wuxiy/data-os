# 下一阶段功能补齐计划（G21–G26）

> 日期：2026-09-20
> 状态：待用户批准；本文只规划，不启动实施
> 定位：功能迭代 G 系列，与生产化 H4/H5 分开提交、分开验收
> 依据：当前代码、G1–G20 验收事实、门户真实/演示边界、2026-09-20 模块完成度审查

## 一、建议结论

下一阶段建议用 **G21–G26 六个独立 Gate、47–70 人日、4–6 人团队约 7–10 周**，把当前仍为原型或无入口的五个产品面补成真实能力：

1. 数据标准；
2. 标准映射；
3. 管理驾驶舱与运营中心；
4. 交付中心；
5. 受控智能问数 Beta。

在新增功能前先执行 G21「功能可信基线」，关闭当前 CI、分析入口、Data API 一致性和 AI Data 清单语义问题。G21 属于现有功能正确性，不启动 H4/H5，也不扩成生产加固批。

本计划以“**所有一级门户模块在真实模式下都有真实数据源、真实动作或诚实拒绝**”为完成定义；不以“页面可打开”或“演示模式可点击”代替功能验收。

## 二、阶段目标与成功标准

阶段完成时必须同时满足：

- 门户一级导航中“运营中心”“交付中心”均有真实路由；
- 数据标准、标准映射、管理驾驶舱、智能问数在真实模式下不再读取 `mock.ts` 或 `integrations.ts`；
- 治理导航中的血缘与影响、问题闭环、数据合同均可进入现有真实能力，不再显示无动作占位；
- 标准和映射具备版本、评审、发布/生效、停用、影响分析和审计，不只是 CRUD；
- 管理驾驶舱与运营中心的每个指标都可下钻到现有任务、问题、主索引候选、数据服务或 AI Data 作业；
- 交付项目可以绑定真实资产并生成不含 PHI、密钥或连接串的不可变验收证据快照；
- 智能问数至少支持 3 个基于已发布 Data API 服务的可复核问题，未知问题明确拒答，不生成任意 SQL；
- 每个 Gate 都有自动化测试、开发环境真实链路证据和独立回滚路径；
- G21 后远端现有 CI 恢复为绿色；最终 Gate 完成后六个子工程本地全量测试均通过。

## 三、范围边界

### 本阶段建设

- 控制面内新增 `standard`、`mapping`、`delivery`、`assistant` 深模块；不新增微服务。
- 复用现有 PostgreSQL、Doris、OpenMetadata、质量执行器、Data API、MPI、AI Ready 和门户原语。
- 门户补齐真实路由、真实 API、错误/空/加载状态和桌面端验收。
- 标准映射验证只返回类型、覆盖率、未映射值摘要等聚合证据，不返回行级医疗数据。
- 智能问数采用“已验证问题 → 已发布数据服务”的确定性路径；保留未来替换分类器的接缝。

### 本阶段不建设

- 不启动 H4/H5，不做 HA、系统性压测、故障注入、完整生产 Compose 或全量 CI 矩阵扩容；
- 不部署 HAPI FHIR Terminology；标准中心只提供可审计的 FHIR R4 `CodeSystem` / `ValueSet` / `ConceptMap` 导出；
- 不把标准映射自动编译成全院数仓转换作业；本阶段交付治理、验证与发布清单，自动编排归 H4 的外部运行接入；
- 不建设通用指标语义层、AI Analyst、任意 Text-to-SQL、DB-GPT 或 LLM 接入；
- 不做 MPI 批量裁决；真实复核量未达到现有 U3 的启动条件；
- 不接新的真实院内源系统，不宣称完成真实多医院临床外部效度；
- 不做移动端专属交互。

## 四、总体架构与数据流

跨越门户、控制面、质量执行器、Data API、AI Ready 和现有元数据/数据面，数据流固定如下：

```text
Portal
  ├─ 标准/映射/运营/交付/问数管理 API ──> Control Plane / PostgreSQL
  │                                               │
  │                  ┌────────────────────────────┼─────────────────────┐
  │                  │                            │                     │
  │                  v                            v                     v
  │            OpenMetadata                 Quality Runner          Data API
  │         资产引用/词表同步              映射聚合验证          已发布查询执行
  │                  │                            │                     │
  │                  └──────────────┬─────────────┘                     │
  │                                 v                                   │
  │                              Doris <────────────────────────────────┘
  │
  └─ AI Ready 通过控制面映射覆盖率投影消费已发布映射，不复制第二份映射仓
```

边界规则：

- PostgreSQL 治理注册库是标准、映射、交付项目和已验证问题的唯一事实源；
- OpenMetadata 继续只持有资产、血缘、Owner 和词汇投影，失败时标记 `SYNC_PENDING`，不反向成为流程状态源；
- Data API 继续独占 SQL 模板校验、机构范围、限额、熔断和调用审计；智能问数不得复制查询执行器；
- 质量执行器只执行受约束的映射聚合验证，不拥有标准或映射生命周期；
- AI Ready 只消费发布后的映射覆盖率，不维护另一份 FHIR 映射表。

## 五、Gate 计划

### G21：功能可信基线

**投入：6–9 人日；必须最先完成。**

目标是让现有功能与测试结果可信，再新增业务面：

- 修复当前提交的远端 CI：控制面 3 个时序/隔离失败、quality-runner 漏装 `httpx`、生产 Compose 校验缺失测试 secret；不在本 Gate 新增 H5 全量矩阵；
- 修复开发环境分析看板 `503`（Superset 路由 `404`），完成列表、访客令牌和嵌入页真实 smoke；
- Data API 导出 claim 必须以 CAS 成功为继续条件；claim 异常不得继续执行；服务缺失失败分支必须正确终态；审计回写必须检查 HTTP 失败并进入现有持久缓冲；
- Data API 服务部分更新在未传 `parameters` 时必须沿用持久化参数；API Key 签发/吊销只允许平台/租户管理员，数据工程师保留服务定义编辑权；
- AI Data 构建清单的 `containsPhi` / `deidentified` 必须来自实际 Recipe 执行步骤和扫描结果；评估必须读取指定产品版本的 Manifest，不得只把 product/version 当报告标签；
- `ProductScopeNotice` 只更新已真实恢复的状态，不提前宣称 G22–G26 完成。

验收：

- Data API 覆盖 claim 竞争失败、控制面 `4xx/5xx`、服务缺失、重启恢复和重复 worker；
- AI Ready 覆盖“关闭脱敏但输入含 PII”“不同产品 Manifest 得到不同评估事实”；
- 当前 GitHub Actions 同一提交全绿，本地六子工程与门户测试全绿；
- 开发环境分析看板列表和一个嵌入页返回成功，失败路径仍显示真实不可用状态。

### G22：数据标准中心真实化

**投入：8–12 人日；依赖 G21。**

新增控制面 `standard` 模块与 Flyway V17：

- `data_standard`：标准集合与租户归属；
- `data_standard_version`：不可变版本，状态 `DRAFT → IN_REVIEW → PUBLISHED → DEPRECATED`；
- `data_standard_element`：数据元、类型、必填性、定义、敏感级别和引用；
- `data_standard_value`：值域代码、显示名、有效期；
- `data_standard_event`：提交、发布、停用和同步事件。

公开接口固定为：

- `GET/POST /api/v1/data-standards`
- `GET /api/v1/data-standards/{id}`
- `POST /api/v1/data-standards/{id}/versions`
- `PUT /api/v1/data-standard-versions/{versionId}`
- `POST /api/v1/data-standard-versions/{versionId}/submit`
- `POST /api/v1/data-standard-versions/{versionId}/publish`
- `POST /api/v1/data-standard-versions/{versionId}/deprecate`
- `POST /api/v1/data-standards/import?dryRun=true|false`
- `GET /api/v1/data-standard-versions/{versionId}/compare/{otherVersionId}`
- `GET /api/v1/data-standard-versions/{versionId}/impact`
- `GET /api/v1/data-standard-versions/{versionId}/fhir-bundle`

规则：

- 只有 DRAFT 可改；PUBLISHED 内容不可覆盖，只能新建版本；
- 导入支持平台 CSV 模板和内部 JSON Schema，先 dry-run 再落库；
- 发布权限为平台管理员/租户管理员；数据工程师可起草和提交；普通治理用户只读；
- 发布后向 OpenMetadata 同步术语引用；失败只置 `SYNC_PENDING` 并允许人工重试，不伪造成功；
- 门户数据标准页接真实 API，补齐列表、详情、版本对比、导入预检、评审和影响范围。

验收：同码重复、版本倒退、非法类型、空值域、越级发布、跨租户读取均被拒绝；OpenMetadata 不可用时标准仍可读，状态明确；FHIR 导出校验稳定且不包含内部数据库标识。

### G23：标准映射与治理工作台真实化

**投入：10–15 人日；依赖 G22。**

新增控制面 `mapping` 模块与 Flyway V18：

- `standard_mapping_set`：源资产、目标标准和当前活动版本；
- `standard_mapping_version`：不可变版本，状态 `DRAFT → IN_REVIEW → ACTIVE → RETIRED`；
- `standard_mapping_item`：源字段、目标数据元、受控转换和人工结论；
- `standard_mapping_validation`：验证范围、聚合结果、数据时间和校验和；
- `standard_mapping_event`：评审、生效、回退和停用事件。

转换只允许 `COPY / TRIM / UPPER / DATE_FORMAT / VALUE_MAP`，禁止任意 SQL、脚本或表达式。发布版本形成带 checksum 的不可变 Mapping Manifest；活动版本指针可回退到上一已发布版本，历史事件不删除。

质量执行器新增同步、只读的聚合验证契约：

- `POST /api/v1/mapping-validations`
- 只接受已登记 dataset、列名和受控转换；
- 返回类型兼容性、空值率、值域覆盖率、未映射值 TOP N 和数据时间；
- 不返回原始行、患者标识或任意 SQL 结果。

控制面接口固定为：

- `GET/POST /api/v1/standard-mappings`
- `GET /api/v1/standard-mappings/{id}`
- `POST /api/v1/standard-mappings/{id}/versions`
- `PUT /api/v1/standard-mapping-versions/{versionId}`
- `POST /api/v1/standard-mapping-versions/{versionId}/import?dryRun=true|false`
- `POST /api/v1/standard-mapping-versions/{versionId}/validate`
- `POST /api/v1/standard-mapping-versions/{versionId}/submit`
- `POST /api/v1/standard-mapping-versions/{versionId}/activate`
- `POST /api/v1/standard-mapping-versions/{versionId}/retire`
- `POST /api/v1/standard-mappings/{id}/rollback/{versionId}`
- `GET /api/v1/standard-mapping-versions/{versionId}/impact`

ACTIVE 前必须存在同一内容 checksum 的 PASS 验证证据。

门户标准映射页接真实资产字段和标准版本；治理导航同步完成：

- “血缘与影响”进入资产技术视图并带资产筛选；
- “问题闭环”进入现有质量问题工作台；
- “数据合同”进入现有数据服务合同视图；
- 不复制血缘、问题或合同状态机。

AI Ready 的 `fhir_mapping_coverage` 改为消费 ACTIVE Mapping Manifest 的真实覆盖率；未配置映射时仍为 N/A，配置后探针失败必须为 FAIL，不能静默回 N/A。

验收：至少以 `ods_ep.ep_mz_cfzb` 完成一版字段映射的“导入 → 聚合验证 → 评审 → 生效 → 影响查看 → 回退”；源字段失效、标准版本停用、覆盖率不足、质量执行器不可用和并发激活均有明确结果。

### G24：管理驾驶舱与运营中心真实化

**投入：7–10 人日；依赖 G21，可与 G22 并行。**

不新建状态表，复用现有各域事实形成只读投影：

- `GET /api/v1/operations/summary`
- `GET /api/v1/operations/work-items`
- `GET /api/v1/operations/events`

投影覆盖：采集失败/停滞运行、治理问题 SLA、通知和合同投递积压、MPI 待复核、Data API 调用失败、AI Data 构建任务、资产/分析配置状态。每一项必须带 `sourceType/sourceId/asOf` 并能深链到真实工作台。

门户改造：

- 管理驾驶舱移除 `managementMetrics`、`riskRanking` 等静态事实；
- 新增“运营中心”真实路由，面向治理负责人展示跨域待办；
- “平台运维”继续面向技术角色展示组件探针，两者不合并；
- 系统总状态明确显示覆盖组件数，不能用三个探针代表整个平台 READY；
- 分页、筛选、加载/空/错误态复用现有 hooks 与 Drawer 原语。

验收：从首页任一红色指标两次点击内到达责任对象；模拟 Superset 503、通知积压、MPI 候选和 AI 构建失败时，摘要与明细一致；API 不可用时不显示静态回退。

### G25：交付中心与验收证据包

**投入：8–12 人日；依赖 G24 的统一投影。**

新增控制面 `delivery` 模块与 Flyway V19：

- `delivery_project`：交付范围、Owner、目标日期和状态；
- `delivery_item`：引用 `ASSET / DASHBOARD / DATA_SERVICE / AI_DATA_PRODUCT`；
- `delivery_snapshot`：不可变验收快照、摘要 checksum 和创建人；
- `delivery_event`：状态、验收和归档事件。

生命周期为 `DRAFT → IN_PROGRESS → READY_FOR_ACCEPTANCE → ACCEPTED → ARCHIVED`。READY 前逐项检查引用存在、状态可交付、质量/认证/合同证据可读取；失败项明确阻断，不自动跳过。

接口固定为：

- `GET/POST /api/v1/deliveries`
- `GET/PUT /api/v1/deliveries/{id}`
- `POST /api/v1/deliveries/{id}/items`
- `DELETE /api/v1/deliveries/{id}/items/{itemId}`
- `POST /api/v1/deliveries/{id}/snapshot`
- `POST /api/v1/deliveries/{id}/start`
- `POST /api/v1/deliveries/{id}/submit`
- `POST /api/v1/deliveries/{id}/accept`
- `POST /api/v1/deliveries/{id}/archive`
- `GET /api/v1/deliveries/{id}/evidence.zip`

快照和状态动作要求 `Idempotency-Key`。证据包只包含 manifest、版本、质量结论、认证/合同状态、运行摘要、事件清单和 checksum；不得包含行级数据、SQL、Token、Secret、连接串或患者标识。

门户新增“交付中心”一级路由，完成项目、交付项、阻断项、证据快照、验收和下载闭环。

验收：以一个 Dashboard、一个 Data Service 和一个 SERVING AI Data Product 建立交付项目，完成提交和验收；引用下线、质量未通过、重复验收、证据源 503 和跨租户访问均被正确处理；同一幂等键只生成一份快照。

### G26：受控智能问数 Beta

**投入：8–12 人日；依赖 G21，可在 G23–G25 后验收。**

本 Gate 不做任意自然语言转 SQL。新增 Flyway V20：

- `assistant_verified_question`：问题代码、别名、参数 Schema、已发布 Data Service 引用、回答模板和状态；
- `assistant_query_audit`：用户、租户/机构范围、问题代码、服务版本、参数摘要、结果行数、耗时、结局和反馈；不存结果行。

状态为 `DRAFT → PUBLISHED → DEPRECATED`。首批固定使用现有真实数据服务：

1. `prescription-daily-summary`：日期范围内处方量趋势；
2. `prescription-department-daily`：科室日处方量；
3. `medicine-record-daily`：每日用药记录量。

控制面提供：

- `GET /api/v1/assistant/questions`
- `POST /api/v1/assistant/query`
- `POST /api/v1/assistant/feedback`

控制面只做问题匹配、用户范围和回答编排；查询经 Data API 新增的 `/internal/v1/verified-queries/{serviceCode}/query` 执行，复用现有 SQL 模板、参数校验、机构范围、熔断和审计，不复制执行器。

服务间认证使用独立 Keycloak client `dataos-assistant-bff` 和 audience `dataos-data-api`。控制面使用 `DATAOS_ASSISTANT_OIDC_TOKEN_URI`、`DATAOS_ASSISTANT_OIDC_CLIENT_ID`、`DATAOS_ASSISTANT_OIDC_CLIENT_SECRET`、`DATAOS_ASSISTANT_OIDC_AUDIENCE`；Data API 资源端使用 `DATA_API_RESOURCE_ISSUER`、`DATA_API_RESOURCE_AUDIENCE`、`DATA_API_RESOURCE_JWKS_URI`。只有 client secret 是秘密值，存部署机 `0600` 文件；其余为非秘密配置。不新增第三方账号、模型 Key 或互联网依赖。

门户智能问数和专业工作区接真实接口：显示支持问题、参数范围、结果、服务版本、统计窗口、数据时间和查询证据。无法匹配、参数越界、无权限或下游不可用时明确拒答；禁止回退演示答案。演示模式仍可保留现有样例并显式标记。

验收：3 个问题与 Doris 人工 SQL/Data API 直接调用逐项零误差；同义表达命中同一问题代码；未知问题、越权机构、非法日期、超限、服务下线、Data API 503 均无 SQL 执行副作用；反馈可追到具体审计记录。

## 六、排期与依赖

```text
G21 功能可信基线
  ├── G22 数据标准 ──> G23 标准映射与治理工作台
  ├── G24 管理驾驶舱/运营中心 ──> G25 交付中心
  └── G26 受控智能问数 Beta（可开发并行，建议最后做整体验收）
```

| Gate | 人日 | 主要模块 | 独立交付价值 |
| --- | ---: | --- | --- |
| G21 | 6–9 | 全栈现有能力 | 当前功能与 CI 恢复可信 |
| G22 | 8–12 | control-plane / portal / OM | 可独立管理、评审和发布标准 |
| G23 | 10–15 | control-plane / quality-runner / ai-ready / portal | 映射治理、验证、影响和 AI 覆盖率闭环 |
| G24 | 7–10 | control-plane / mpi / portal | 真实管理总览与跨域运营待办 |
| G25 | 8–12 | control-plane / portal | 交付项目与验收证据闭环 |
| G26 | 8–12 | control-plane / data-api / portal | 三类真实问题的受控问数 |

总投入 **47–70 人日**。推荐一个 Gate 一个提交序列和一份 `docs/validation/gate-*-<date>.md`，不得把 H4/H5 事项混入同一提交。

## 七、统一验证矩阵

每个 Gate 除模块专项测试外，至少覆盖：

| 场景 | 必须证明 |
| --- | --- |
| 正常主链 | 创建/发布/执行/下钻的真实状态和数据一致 |
| 非法流转 | 越级、重复、已发布覆盖、并发动作被拒绝 |
| 数据边界 | 空集、NULL、未知代码、日期边界、分页上限结果明确 |
| 权限边界 | 跨租户、跨机构、角色越权拒绝且审计存在 |
| 依赖故障 | OM、质量执行器、Superset、Data API 任一 503 时诚实降级，不回 mock |
| 幂等并发 | 相同幂等键和并发请求只有一次业务副作用 |
| 隐私 | API、日志、证据包不出现 PHI、Secret、连接串或任意原始样本 |
| 回滚 | 活动版本/功能入口可回到上一版本，历史审计不删除 |

最终验证命令按 `AGENTS.md` 执行六子工程全量测试；门户额外运行 mock audit、交互 smoke 和生产构建。浏览器以 1440×900 为主、1280px 为最小桌面宽度，逐项验证真实模式和显式演示模式。

## 八、故障、规模与回滚设计

- **依赖失败**：标准/映射本地事实可读，外部同步显示待重试；运营投影局部 UNKNOWN；问数直接 503，不降级为假答案。
- **10 倍规模**：标准、映射、运营和交付列表全部服务端分页；映射验证只执行带超时和行数上限的聚合 SQL；证据包不打包业务数据。
- **回滚**：V17–V20 全部为加法迁移；已发布版本不可改，活动指针可回上一发布版本；门户路由可按后端能力探测隐藏，但已经产生的标准、映射、审计和交付快照不删除。
- **表面增量**：新增 0 个微服务、0 个第三方 SaaS、0 个模型 Key；G26 新增 1 个内部 OIDC client、1 个 secret 配置和 6 个可提供默认值的非秘密 OIDC 配置。

## 九、关键决策与取舍

1. **先补治理与操作闭环，不先做通用 AI。** 标准、映射、运营和交付是当前明确缺口，且不依赖外部业务 Owner。
2. **问数先做可验证问题，不做 Text-to-SQL。** 复用 Data API 能把权限、限额和审计保持在一处；未知问题拒答比生成不可审计 SQL 更符合医疗场景。
3. **标准事实留在治理注册库。** OpenMetadata 和 FHIR Bundle 是投影/交换格式，不接管版本与审批状态。
4. **运营中心与平台运维分开。** 前者面向治理负责人处理业务待办，后者面向技术角色看组件探针。
5. **不借功能迭代偷跑生产化。** H4/H5、生产编排补齐和完整 CI 覆盖继续由用户逐批明示。

最小替代方案是只把数据标准、映射和问数页面隐藏；它能减少“未完成”曝光，但不能形成完整产品，因此不采用。

最脆弱假设是：下一阶段目标是“受控内测下的门户功能完整”，而不是“立即达到生产发布”。如果目标改为生产发布，H4/H5、生产 Compose、HA 与全量 CI 必须进入同一阶段，排期会显著增加。

## 十、批准后的执行入口

批准本计划后只启动 G21。G21 gate 全绿并经复盘后，再按 `G22 + G24` 可并行、`G23` 跟随 G22、`G25` 跟随 G24、`G26` 最后整体验收的顺序推进；任何 Gate 新发现的安全、生产加固或系统性深测事项只记入延期台账，不自动扩项。
