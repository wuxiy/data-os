# 技术探针结论：HAPI FHIR MDM 适用度 与 Superset 门户嵌入 — 2026-08-19

背景：门户迭代（G3 MPI / G4 分析页）选型前的两项定向探针，对应蓝图 §15「HAPI FHIR MDM 适用度」决策门与「分析页形态」选型。全部结论基于开发机实测。

## S1. HAPI FHIR MDM 适用度：有条件适用，建议作可切换引擎而非主引擎

**部署**：源码构建（starter master = HAPI 8.x / Spring Boot 3.5 / Java 21，boot WAR 378MB），temurin 容器运行，53 秒启动，H2 零配置（生产支持 PostgreSQL），常驻一个有状态 JVM 服务。（Docker Hub 当日不可达，镜像路线失败后改源码构建成功——分发路径本身也是运维成本项。）

**实测通过的能力**：

| 能力 | 证据 |
| --- | --- |
| MDM 管道 | 303 EP 患者灌入（4 秒），全部生成黄金记录 + AUTO 链接（subscription 异步驱动） |
| EID 匹配路径 | eidSystem 对准卡号后，同卡源即时自动合并、标识传播到黄金、黄金归并（225 黄金/303 源） |
| 确定性规则语义 | matchResultMap 按「命中字段组合」映射：卡号+姓名→MATCH、仅卡号→POSSIBLE 的保守原则可表达 |
| 人工合并 | `$mdm-merge-golden-resources` 200，黄金版本化（versionId 2） |
| 链接查询 | `$mdm-query-links` 顶层 Parameters 分页返回 303 条 |
| 中文精确匹配 | 姓名检索/STRING matcher 对中文无障碍 |

**实测风险与缺口（阻断级在前）**：

1. **姓名候选搜索未生效**：三种规则配置下，MDM 内部候选搜索对姓名恒为 0（手工 FHIR 检索与 GOLDEN_RECORD 标签过滤检索均正常、黄金记录带姓名）——引擎行为与检索行为不一致，时盒内未定位根因。字段组合式 POSSIBLE_MATCH 因此未能自动产出。
2. **EID 语义双刃剑**：卡号设为 eidSystem 时，真实数据中的同卡不同人被自动硬合并（1064 实测被并）——恰是蓝图 8.1 警告的误合并；医疗场景人级 EID 常缺失，EID 路径需慎用。
3. **非 EID 标识不传播到黄金记录**：标识类候选发现对黄金失效。
4. **拆分/撤销未验证**：`$mdm-split-or-duplicate-golden-resource` 本构建未注册（not-supported）；`$mdm-update-link` 端点存在但 Parameters 形状需按官方文档/客户端再核（三种 curl 形状均报参数缺失）。
5. 规则 schema 跨版本差异大（本次踩了三处 breaking：searchParams 数组、candidateFilter 字段名、weight→组合映射），学习/维护成本实存。

**建议**：G3 主引擎维持**轻量确定性匹配**（Doris/控制面，与门户工作台一体交付）；HAPI FHIR MDM 定位为**可切换引擎选项**保留评估——其 FHIR 表达、黄金/审计、人工合并模型与蓝图 8.1 高度吻合，但上述 1/4 未解前不满足演示档确定性。若坚持 HAPI 路线，追加一个定向排障窗口（升级最新版 + 社区核实候选搜索 + update-link 正确形状 + split 注册情况）。

## S2. Superset 页面可直接嵌入门户：可行，建议作为 G4 分析页主路径

实测链路（版本 4.1，data-ops 自建镜像 `medical-platform/superset:4.1`，全部 200）：

| 环节 | 结果 |
| --- | --- |
| 启用嵌入 | `FEATURE_FLAGS={"EMBEDDED_SUPERSET": true}` + Talisman 配置追加 + 重启；配置备份 `superset_config.py.bak-embed-spike` |
| 嵌入白名单 | `POST /dashboard/2/embedded {"allowed_domains":["http://172.16.65.59:18081"]}` 成功——官方域名白名单机制可用 |
| Guest Token | admin JWT → `/api/v1/security/guest_token/`（用户身份 + 资源范围 + RLS + TTL）签发成功——甲方免登录、按仪表盘限权、支持行级安全 |
| 页面嵌入 | `/superset/dashboard/2/?standalone=2&ui=false` 200，无 X-Frame-Options/CSP 阻断头；HTTP 门户页嵌 HTTPS iframe 不属混合内容（反向才受限） |
| 数据真实性 | Doris 连接（mysql 协议）→ `ods_ep.ep_mz_cfzb` 数据集 → 饼图，图表 17 个状态值与 Doris 直查**零误差** |
| API 姿势 | 登录 → csrf_token → Cookie+X-CSRFToken 双提交已趟平；容器内根路径 vs 网关 `/superset` 前缀差异已确认 |
| 前端 | `@superset-ui/embedded-sdk`（框架无关 postMessage）适配门户 React 19 |

**建议**：G4 分析页采用「**嵌入式 Superset 仪表盘为主 + 门户自绘关键指标卡为辅**」——guest token 模式下甲方看到的仍是门户内页面（无 Superset 登录、不见组件拼盘），比纯自绘更快获得专业图表能力。集成时补两小项：显式 CSP frame-ancestors 白名单（本探针的自定义 CSP 段未完全生效，当前无阻断头但生产应收紧）、控制面 BFF 增加 guest-token 签发代理。

## 环境状态（探针遗留，供后续使用/清理）

- `hapi-mdm-spike` 容器保留在运行（18095，H2 数据在容器内，重建即清）；WAR/规则/患者样本在开发机 `/root/spike-hapi/`。
- Superset：嵌入特性已开启并保留；spike 管理员 `dataos-spike`（口令 `/root/spike-hapi/superset-spike-pw`）；已建 Doris 连接 `doris-ods-ep`、数据集 id=2、图表 id=4（处方状态分布）、仪表盘 id=2（电子处方嵌入验证）——可直接作为 G4 嵌入试点对象。
- Doris：`dataos_quality_ro` 已加 `ods_ep` 读权限与 compute group 使用权（G1 前置已就绪）。
