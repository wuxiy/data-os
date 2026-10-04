# Gate · G2G 批次 4 第二刀：部署登记面 + 采集水位卡（批次收官）

- 日期：2026-10-04
- 依据：[g2g-batch4-edge-ops-plan-20261004.md](../g2g-batch4-edge-ops-plan-20261004.md)；参考物 nema `nodeDeploy`/`monitor`
- 结果：**通过**（runner 53/53、control-plane 契约 7/7 + 全量零回归、前端链全绿、浏览器核验双面 + 视觉两轮修复后合格）

## 交付范围

### 映射裁决落地

- **nodeDeploy 降级为登记面**：不做制品分发/远程部署（MiNiFi 路线人工/运维通道发布），控制面只登记「哪个节点、什么版本、什么产物引用、谁发布的」——发布历史即运维审计线。
- **monitor → 采集水位卡**：不做节点性能监控，平移「采集到了吗、到哪了」的运维视角。水位从 Doris 边缘表（ods_ep.ep_mz_*_edge）聚合而来，只读、聚合、白名单三重约束（对齐 G23 mapping_validation 只读契约先例）。

### 组件

- **quality-runner `edge_watermark.py`**：`GET /api/v1/edge/watermarks`（scope quality:read）。表白名单硬编码（cfzb/ypcfmx 两张边缘表，键→(库, 表)），每表三条聚合查询：总行数 / `MAX(UPDATE_TIME)` 最近写入 / 近 7 天按日入仓行数（GROUP BY DATE）。无调用方表名/列名输入，无行数据返回。`test_edge_watermark.py` 以伪 doris_query 捕获 SQL，断言白名单表名与聚合-only 形态。
- **control-plane V27 `data_os.edge_deployments`**：节点 FK、version/artifactRef/note、deployedBy（OIDC subject，缺省「控制台」）、deployedAt；`GET/POST /v1/edge/nodes/{id}/deployments`（版本必填 ≤64、artifactRef ≤300、note ≤500；租户经 edge_nodes 子查询继承）。发布后返回全量历史（倒序）。
- **`EdgeWatermarkClient` + `GET /v1/edge/nodes/watermarks` 代理**：镜像 DynamicRulePushClient 形态（`data-os.quality.base-url` + client credentials，quality:submit quality:read）；未配置→AdapterUnavailableException（503 语义）。路由置于任何 `/{nodeId}` 通配之前（无遮蔽）。
- **portal**：EdgeNodesPanel 顶部水位卡区（双卡：数据集名/累计行数/最近写入/近 7 天按日柱状条，静默降级——runner 不可用时卡片区不渲染不报错）；节点行「发布记录」抽屉（登记表单 + runTimeline 历史）。
- **行内「更多」菜单定位修复（跨页共享）**：`rowMoreToggle` 助手 + 两表接线（采集任务表/前置机表）。打开时实测裁切容器（overflow≠visible 祖先）可用空间：下方够向下弹、否则上方够向上弹、两侧都不足（单行表）夹取容器内完整可见（内联 top 定位，随行滚动锚点不漂移）。

## 测试证据

- runner：`test_edge_watermark.py` 新增，53/53 全绿（断言 2 表、6 条查询全为聚合、表白名单）。
- control-plane：`EdgeDeploymentApiTest`（stub runner HttpServer + @DynamicPropertySource）——发布记录空→登记（version/artifactRef/note 落库、deployedBy=OIDC subject）→历史倒序；未配 base-url 时水位代理 503、配好后代理透传（dataset/totalRows 12034/dailyCounts 412 逐字段）；404 未知节点、400 缺 version。含第一刀在内 edge 域 7/7，全量 `mvn test` 零回归。
- 前端链全绿（tsc/vitest/mock-audit/portal-interactions-smoke/build）。
- 浏览器核验（mock 控制面 + vite）：水位卡两卡渲染（ods_ep.ep_mz_cfzb_edge 12,034 行 / ep_mz_ypcfmx_edge 87,210 行、7 日柱、最近写入时间）；发布抽屉空历史→登记 minifi-1.22-flow-v3→历史呈现（deployedBy local-development）。
- **视觉两轮实抓并修复**：① mock 路由遮蔽（cut-1 的 `edgeMatch` 通配把 `watermarks` 吞成 nodeId → 404，水位卡 0——watermark 分支前移修复，真实后端无此问题）；② 操作列 4 按钮溢出裁切（收敛为 探测/发布/⋯ 更多菜单）→ 首版 data-flip 上弹在单行表仍顶出容器上缘 55px（上侧同裁）→ 终版完整定位算法（下/上/夹取三分支）。双页程序化验证 fullyInside + 命中点在菜单内，视觉判定合格（operations 上弹菜单完整可见；ingestion 单行表夹取 572–670 精确适配容器）。toggle 事件异步派发的测量时序坑（同步读在事件派发前，flip 假阴性）记录在案。

## 边界（记 backlog）

1. 水位表白名单硬编码（cfzb/ypcfmx + UPDATE_TIME 列名）；新边缘表入卡需改 runner 代码。配置化候选。
2. 发布登记无制品二进制（artifactRef 只是引用串）；「谁在哪台节点上跑了什么」为人工登记事实，无真实性校验。
3. 水位查询直连 Doris 聚合（无缓存）；表增大后 COUNT(*) 成本随表线性。
4. rowMoreToggle 定位在打开瞬间计算，打开后滚动容器不重算（菜单随行滚动，极端滚动后可能与容器边缘相切——原生下拉惯例是滚动即关，此处从简）。

## 批次收官

批次 4（边缘运维域）两刀齐：节点台账+探活（cut 1）+ 部署登记+水位卡（本刀）。nema dep 四域中 node/nodeDeploy/monitor 以「中心探活衍生状态 + 登记面 + 聚合水位」形态收编，nodeServer 的 ssh/文件分发面维持不平移裁决。G2G 剩批次 5（ETL 调度中文化接 DolphinScheduler）、批次 6（MPI 实战参数移植）、批次 7（Keycloak 统一认证）。
