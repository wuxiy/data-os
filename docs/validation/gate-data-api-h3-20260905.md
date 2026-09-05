# Gate：H3 Data API 生产化（P7 异步导出 + P8 限流熔断 + S9 fail-open 收敛）

> 批次：H3（docs/production-hardening-batch-plan-20260903.md §二）。
> 日期：2026-09-05。提交链：5cb1f54（S9）→ 9477183（P7）→ 0385901（P8）→ 收口提交。
> 同场交付的姊妹项：OM catalog 补喂（3d7d3c6，备忘 P3 残留小项）与
> 生产 ENFORCED 门户用户链归档（f592a54，H2 未竟面），证据见 §六。

## 一、验收范围与结论

| 项 | 内容 | 结论 |
| --- | --- | --- |
| S9 | `_hospitals_of` 坏 JSON 静默回退 `["*"]`（全院放行）；catalog 绕过调决；审计 4 处手调 | **PASS**：CallSession 单一属主 + fail-closed + catalog 走全调决 |
| P7 | 大结果集异步导出至对象存储 + 下载 URL（§5.8 完整形态） | **PASS**：任务状态机 + RustFS 产物 + 鉴权下载回放，146 行对账零误差 |
| P8 核心 | 网关级限流 / Doris 熔断 / 审计回写失败持久化缓冲 | **PASS**（自助门户与合同变更通知按规划继续延后——真实调用方出现前无验收对象） |

测试基线：control-plane **204/204**（新增 DataServiceExportTest 5 项，存量零修改）；
data-api **37/37**（新增 13 项：S9 7 + 导出 6 + 韧性 8 中部分归并，存量 16 项零修改）；
前端面不动。

## 二、S9 收敛（CallSession 调决深化）

设计：`services/data-api/app/session.py` 的 `CallSession` 成为一次调用的
**鉴权调决与审计出口单一属主**——key 匹配（registry 不可达收口 503
`REGISTRY_UNAVAILABLE`）→ 服务绑定 → 日配额；医院授权解析 fail-closed。

- 坏 JSON / 非数组 → 403 `HOSPITAL_SCOPE_INVALID`（此前静默 `["*"]` 全院放行）；
  字段缺失仍视为 `["*"]`（与控制面发放语义对齐——发放侧空即存 `["*"]`）。
- catalog（GET /v1/services）不再内联复制 401 分支：绑定/配额照走
  （S9 前无此检查），元数据读不审计；schema 同口径。
- query 全结局审计：401 坏 Key / 403 绑定 / 429 / 404 / 503 均落审计
  （此前这些路径零记录）；「未携带 Key」的匿名探测不审计（无身份素材）。

dev 实证（坏 JSON Key 直插库后实测）：

- query → `{"code":"HOSPITAL_SCOPE_INVALID","message":"Key 的医院授权配置损坏（坏 JSON），已拒绝执行"}`；
- export 提交同样 403；同 Key catalog 200（鉴权/绑定正常，仅授权损坏被拒）；
- 两条 403 审计均落库（`kind=query, status_code=403`）。

## 三、P7 异步导出

控制面（V14 `data_os.data_service_export`）：

- 状态机 PENDING → RUNNING → SUCCEEDED/FAILED，SUCCEEDED 到期转 EXPIRED；
  RUNNING 认领是 CAS（`WHERE status='PENDING'`），双认领安全。
- 内部端点：POST/GET `/internal/data-api/exports*`（create/claim/finalize/
  pending 拾取/expire/reap-stale）；管理面 `GET /api/v1/data-services/{id}/exports`。
- `data_service_call` 加 `kind`（query/export）：导出完成计入日配额窗口
  （失败导出 status≥500 不计）。

data-api（`exports.py` + `artifacts.py`）：

- 提交同步校验（同 query 的鉴权/参数/医院范围/配额），202 + 后台 worker；
  worker 流式执行（pymysql SSCursor）写 utf-8-sig CSV（Excel 中文口径），
  上传 RustFS 桶 `dataos-data-api-exports`（artifacts 模式第二消费者，
  同惯例自抄 + 本地目录退化），终态回写并按 kind=export 计审计。
- 下载走鉴权端点回放（`GET /v1/exports/{id}/download`）：归属校验
  （仅创建 Key 可见，存在性不泄漏）、未完成 409、过期 410；**不走
  presigned URL**——内网 S3 host 浏览器不可达，且统一走既有认证与限流面。
- 生命周期：保留期默认 7 天（小时级维护清理 + 控制面到期标记）；
  启动恢复（孤儿 RUNNING 清算 + PENDING 拾取，带 5 次重试容忍 compose
  启动顺序）；状态/下载不烧配额（产物交付不属于新调用）。

dev 实证（prescription-daily-summary，ods_ep 真实数据）：

- 查询基线 rowCount=146；导出 SUCCEEDED rowCount=146，fileBytes=2149，
  `artifactUri=s3://dataos-data-api-exports/data-api-exports/<id>.csv`；
- 下载：147 行（表头+146 数据），BOM/`Content-Disposition`/charset 齐全，
  前三行与查询响应逐值一致——**对账零误差**；
- 管理面 exports 列表端点返回该任务（SUCCEEDED + expiresAt +7d）。

## 四、P8 韧性核心

- **Doris 熔断**（`breaker.py`）：连续 5 次失败 → OPEN 30s（立即 503
  `DORIS_CIRCUIT_OPEN`，审计照落）→ 半开单次试探 → 成功回 CLOSED；
  query 与 export 共用。dev 不做破坏性验证（单测覆盖状态机全迁移）。
- **registry stale-grace**：TTL 过期刷新失败且上次成功在 300s 内 →
  降级用旧投影；超窗才 503。**吊销/新 Key 生效延迟放宽为 TTL+grace
  （30s+300s）**——运维口径。dev 实证：停控制面 + TTL 过期后查询仍 200
  （rowCount=146，旧投影 + Doris 独立可用）。
- **审计持久缓冲**（`auditbuffer.py`）：回写失败落 JSONL（含
  Idempotency-Key，崩溃窗口重放由控制面幂等去重），30s 重放节拍，72h
  超龄丢弃。dev 实证：停机窗口查询的审计落盘 1 条 → 控制面恢复后 30s
  内补投落库（kind=query/200/rowCount=146），缓冲清零。
- **nginx 限流**：`/dataapi/` 每 IP 2r/s、burst 40（dev 生效；production
  nginx 预置 zone + 注释 location，待 data-api 进生产栈时启用）。
  dev 实证：80 并发 → 41 过 / 39 拒（精确命中 burst+速率口径）。

## 五、事故与坑（本批实测）

1. **dev portal nginx 缓存容器 IP**（G4 老坑复发）：control-plane 容器
   重建换 IP 后 nginx 旧解析指向被复用 IP 的 FastAPI 容器，`/api` 出现
   FastAPI 风格 404——重启 portal 容器刷新。重建上游后必重启 portal。
2. **Keycloak 26 声明式用户档案**：未在 realm userProfile 声明的属性名
   被**静默丢弃**（连 admin PUT 也是）——种子脚本已内置幂等声明步骤；
   旧版（无 /users/profile 端点）自动跳过。
3. **Keycloak users PUT 是整实体替换**：部分字段 PUT 会抹掉其余字段
   （丢 firstName/email 触发 VERIFY_PROFILE 拦截首登）——一律 GET-merge-PUT。
4. **PKCE 依赖 secure context**：纯 HTTP 门户（非 localhost）无
   `crypto.subtle`，前端登录按钮报 digest undefined。生产 HTTPS 入口不受
   影响；dev 验收经 SSH 隧道走 localhost（secure context）完成。
5. data-api 先于控制面就绪时启动恢复直接失败——已改维护线程内 5 次重试。

## 六、姊妹项（同场交付，非 H3 范围）

- **OM catalog 补喂**（3d7d3c6，P3 残留小项）：`dbt docs generate` 替代
  parse 步骤（SKIP_TESTS 亦然），catalog 同法 scrub（实测剥
  `invocation_started_at`），模板加 `dbtCatalogFilePath`。dev 实测结论：
  **DataModel=0 是结构性的**——质量工程唯一 model 为 ephemeral，不进
  catalog nodes，OM connector 日志明示 "Unable to find the node or columns
  in the catalog file for dbt node: model.dataos_quality.quality_sample"。
  是否物化一个 view model 属质量工程语义变更，留用户裁决（备忘 P3 记录）。
- **生产 ENFORCED 门户用户链**（f592a54，H2 未竟面归档）：
  `keycloak-portal-seed.sh`（幂等：7 角色 + 公共 client PKCE S256 +
  audience/tenant/institution 三 mapper + 可选演示用户）、`build-portal.sh`
  （OIDC 守卫 + 原子同步 portal-dist）、README 门户用户链章节（含院方
  IdP 等价申请清单）。dev E2E：脚本化 PKCE 全流程（iss/aud/tenant claim
  逐项核对 + 篡改 code 负对照 400）+ 浏览器真实登录（portal-demo →
  门户渲染 + BFF 实数据 9 服务/10 Key）；ENFORCED 窗口后 dev 已还原
  DISABLED 与原门户产物。

## 七、结论与移交

- S9/P7/P8 核心全部关闭并 dev 实证；P8 余项（调用方自助门户、合同变更
  通知）按批次规划继续延后——真实调用方出现前无验收对象（备忘 P8 条目
  改写为余项口径）。
- dev 运行态：control-plane / data-api 镜像 `0.2.0-h3-20260905`
  （DATAOS_CONTROL_PLANE_IMAGE / DATAOS_DATA_API_IMAGE 已钉）；
  V14 迁移成功；RustFS 新桶在位；compose/nginx 改动已同步 dev 栈
  （备份 *.bak-h3）。
- 生产 compose 仍无 data-api 服务段（历史口径）——nginx 已预置限流 zone
  与注释 location，data-api 进生产栈时接线（S8 的 internal-mode 生产侧
  由全局 ENFORCED 主链承担）。
