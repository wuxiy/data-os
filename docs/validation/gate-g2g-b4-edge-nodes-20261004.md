# Gate · G2G 批次 4 第一刀：前置机节点域（台账 + 中心探活）

- 日期：2026-10-04
- 依据：[g2g-batch4-edge-ops-plan-20261004.md](../g2g-batch4-edge-ops-plan-20261004.md)；参考物 nema `views/node`/`nodeServer`
- 结果：**通过**（control-plane 契约 5/5 + 全量零回归、前端链全绿、浏览器核验全链 + 视觉合格）

## 交付范围

### 映射裁决落地

- **边缘形态不复制**：MiNiFi 路线（G5 已 gate）不变；nema 的 dep-node agent/ZK 注册/Kafka 回传、web-ssh/文件分发不平移。
- **节点状态 = 中心探活衍生**：ONLINE（最近探测成功）/OFFLINE（失败）/UNKNOWN（从未探测）；无 agent 心跳通道如实声明（规划文档裁决③）。
- nema 四域裁剪：node（台账+状态+参数）→ 本刀；nodeServer（服务器/web-ssh）→ host:port 台账吸收，ssh/文件面不平移；nodeDeploy（制品/发布）→ 第二刀登记面；monitor → 第二刀水位卡。

### 组件

- **control-plane 新 `edge` 域**：V26 `data_os.edge_nodes`（名称分组站点/主机端口/版本/最近探测三元组/config_json/租户作用域）；`EdgeNodeController`（GET 列表含衍生 state / PUT 登记与更新 / POST `/{id}/probe` 同步探测 / DELETE）；`EdgeNodeService`——主机校验复用 `SourceNetworkPolicy.validateHostPort`（SSRF 同防线）、config 白名单键（relayPrefix/flowName/description/siteLabel，camelCase 归一）+ `JobConfigTree.containsSecretKey` 明文守卫、TCP 探测 3s 超时、失败消息走 `ErrorMessages.safe`；更新保留探测历史。
- **portal**：平台运维页（技术域角色门内）挂 `EdgeNodesPanel`——节点表格（三态徽标 + 探测消息/时间二级文本 + 中转前缀）、登记/编辑抽屉、行内探测（loading 态）与删除。

## 测试证据

- `EdgeNodeApiTest`（5 用例）：登记/列表/UNKNOWN 衍生 + config 白名单落库（relayPrefix 保留、未知键剔除）；**真实 TCP 正负路径**（本地 ServerSocket 监听 → ONLINE「端口可达」；未监听端口 → OFFLINE + safe 消息）；SSRF（169.254.169.254 拒绝）/明文 config 拒绝/port 缺省 400；更新保留探测历史（ONLINE 不因改名重置）+ 删除后探测 404；更新不存在节点 404。全量 `mvn test` 零回归。
- 前端链全绿；浏览器核验（mock）：三态种子渲染（在线绿/离线红/未探测灰 + 消息）、未探测→探测→在线回写、登记（含中转前缀）→ 未探测新行、编辑回填（name/relayPrefix）改站点、删除消失；视觉合格（三态徽标题词、二级文本、按钮对齐）。

## 边界（记 backlog）

1. 探测为同步手动触发（无后台调度/告警）；只保留最近一次探测（无时序历史）。
2. TCP 可达 ≠ 采集流健康（MiNiFi flow 状态不在探测范围；水位卡在第二刀）。
3. config 白名单四键外的键静默剔除（表单只暴露 relayPrefix；其余键留 API 通道）。
4. 端口探测对目标主机的可达性依赖控制面网络位置（院内隔离网段须经运维通道）。

## 第二刀预告

部署登记面（deploy/minifi 产物版本 + 发布记录）+ 前置机采集水位卡（中转桶按日前缀对象计数）。
