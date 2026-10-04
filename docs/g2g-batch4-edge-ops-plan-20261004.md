# G2G 批次 4 · 前置机运维域（规划，2026-10-04）

> 依据：覆盖矩阵 §G2G 批次 4：node/nodeServer/nodeDeploy/monitor 信息架构 + 边缘形态（条件批——矩阵注明「按客户场景触发」；用户令继续，默认开工）。参考物：dep-web `views/node`（697 行：节点列表/状态徽标/参数配置/断点管理）、`nodeServer`（511 行：服务器台账/web-ssh/文件上传安装/ping）、`nodeDeploy`（1227 行：制品仓库/版本/节点发布）、`monitor`（大屏 5 块卡）。

## 勘察结论（两端现状）

### data-os 已有

- **边缘形态已定路线**：MiNiFi 前置机 → RustFS 中转桶 → SeaTunnel S3File 入仓（CONTEXT.md「前置机边缘链路」，G5 已 gate；deploy/minifi 有 flow 生成脚本）。nema 的 dep-node Java agent + ZK 注册 + Kafka 回传**不复制**。
- 平台运维页（`/operations`）：控制面服务端探针（seatunnel/dolphinscheduler/rustfs）30 秒轮询——探活基建先例。
- 批次 1 `SourceNetworkPolicy.validateHostPort`：SSRF 防护可直接复用于前置机主机校验。

### 缺口（=本批要补）

- 无前置机节点台账（注册/分组/状态/参数）；无中心侧可达性监测；无部署版本与发布记录面。

## 映射裁决

1. **边缘形态**：MiNiFi 路线不变；nema 的 agent 分发/web-ssh/文件上传安装**不平移**（部署走 deploy/minifi 脚本与运维手册），nodeDeploy 降格为**登记面**（版本与发布记录，第二刀）。
2. **节点状态 = 中心探活衍生**：控制面对登记的 host:port 做 TCP 可达性探测（同步、带超时），state = ONLINE（最近探测成功且未过期）/OFFLINE（最近探测失败）/UNKNOWN（从未探测）；不做 agent 心跳上报（MiNiFi 无此通道，如实声明）。
3. **探活触发**：手动（行内「探测」按钮）+ 列表刷新时顺带探过期节点（stale 窗口 5 分钟）；不做后台调度（运维页打开即探，成本可控）。
4. **参数配置**（nema node config JSON）保留为 `config_json`（非敏感白名单键），预留 MiNiFi flow 参数描述（如 relay 前缀、站点标识）。

## 第一刀实施设计（本刀）

### 后端（control-plane 新 `edge` 域）

1. V26 `data_os.edge_nodes`：id/name/group_name/host/port/site/version/last_probe_at/last_probe_ok/last_probe_message/config_json/tenant/institution/created_at/updated_at。
2. `EdgeNodeController`：GET 列表（含衍生 state）、PUT 登记/更新、DELETE、POST `/{id}/probe` 同步探测并回写；host 经 `SourceNetworkPolicy.validateHostPort`；config_json 白名单键 + 密钥守卫（沿用 JobConfigTree.containsSecretKey）。
3. TCP 探测：`Socket.connect(addr, timeout=3000)`；失败消息走 `ErrorMessages.safe`。

### 前端（prototype）

4. 平台运维页底部区块「前置机节点」：卡片/表格（名称/分组/站点/主机/版本/状态徽标/最近探测）、登记/编辑抽屉、行内「探测」、删除（离线或确认）。样式随 PlatformOperationsPage 体系。

### 验收

- control-plane：契约测试（CRUD/SSRF 拒绝/明文配置拒绝/探测回写含本地起 ServerSocket 的真实 TCP 正负路径/衍生状态）+ 既有零回归。
- prototype：tsc + vitest + qa 链 + build 全绿；浏览器核验登记→探测→状态回写。

## 第二刀预告

部署登记面（deploy/minifi 产物版本 + 发布记录）+ 前置机采集水位卡（中转桶按日前缀对象计数）+ monitor 大屏的前置机专属卡。

## 收官注记（2026-10-04，两刀全交付）

- 第一刀（节点域）：V26 台账 + 中心 TCP 探活三态衍生 + 平台运维页面板（gate-g2g-b4-edge-nodes-20261004.md）。
- 第二刀（登记面 + 水位）：V27 发布台账、runner 白名单聚合水位端点、控制面代理、门户水位卡/发布抽屉；水位实现口径由「中转桶对象计数」改为 **Doris 边缘表聚合**（桶前缀计数只证上传不证入仓，表聚合才是「入仓水位」；对齐 G23 只读聚合契约）（gate-g2g-b4-edge-deploy-20261004.md）。
- 顺带共享面修复：行内「更多」菜单在滚动容器内的裁切定位（rowMoreToggle，采集任务表/前置机表两处接线）。
- 批次边界维持：不做 dep-node agent、ZK/Kafka、web-ssh/文件分发（规划裁决①）。
