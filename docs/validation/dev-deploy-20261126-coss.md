# dev 环境部署记录 · 2026-11-26（coss ui 改造轮，静态包增量）

> 提交基线：`f8284f0`（main，与 origin/main 一致）｜执行：仅静态包替换，镜像/容器/`.env` 不动
> 回滚目录：`/root/data-os-dev-rollback-20261126-coss`（旧 portal-dist + sha256.old，48 文件）

## 变更内容

| 对象 | 旧 | 新 |
| --- | --- | --- |
| portal-dist | `ab17244b…`（`cc6af79` 构建，2026-11-18 重设计轮，47 文件，`index-Bn0zpgAj.js`） | **`64250eaf…`（`f8284f0` 构建，56 文件，`index-S9mvyL5U.js`，1.8M）** |
| 容器/镜像/`.env` | 不动 | 不动（`cc6af79..f8284f0` 仅门户与文档，`services/` 与 `deploy/` 零变化） |

内容为 coss ui 全面改造合并进 `main`（合并提交 `37795d9`）：组件层整体改用 coss、主从列表改用 `SidebarMenuButton`、断点 800px、命令面板按需加载、首屏闭包 288→220 KB、质量执行器称谓修正。

## 部署守卫

| 守卫 | 结果 |
| --- | --- |
| dist 无 env 文件 | PASS（仅 `.env.production.example` 在仓库、不进 dist） |
| bundle 无 OIDC 门串 | PASS（无 `data-os-portal` / `VITE_DATAOS_OIDC` / `id.example.invalid`） |
| 无 `VITE_DATAOS_DEMO_MODE` | PASS |
| 无本地 mock 地址 | PASS（无 `127.0.0.1:18090` / `127.0.0.1:4173`） |
| 体积预算（同 CI） | PASS：首屏 JS 220.0 / 全部 489.4 / CSS 29.7 KB |

API 基址走构建默认 `'/api'`（相对路径），与 dev nginx 的 `/api` 反代一致，无需构建期 env。

## 验证证据

| 检查 | 结果 |
| --- | --- |
| 三处 hash | 本地 = 宿主 = HTTP：`index.html` `64250eaf…`；入口 JS `index-S9mvyL5U.js` `7fc739e8…` 三方一致 |
| 上传完整性 | `COPYFILE_DISABLE=1` 流式 tar（`tar cf - -C dist .`）；远端 56 文件与本地一致；xattr 警告无害 |
| `/healthz` | HTTP 200 |
| system/status | DEMO（dev 种子口径）、qualityExecutor HTTP configured、operational READY 3/3 |
| 浏览器矩阵（dev 真实 ID） | 28 路由 × 3 宽度（1440/1280/800）84 项 + 壳交互 5 项 + 窄屏断点 6 项断言，通过 95 项；唯一失败项见下 |
| 真实 API 抽查 | sources 10、jobs 77（`g2g5-DS全链` 平台调度任务深链可进）、问数已验证问题 `medicine-record-daily` 详情可进 |
| 真实数据目检 | 总览指标带（77 任务 / 10 源 / 4 问题 / 36 资产）、演示运行模式横幅、质量页 coss 列表与「质量执行器（在线）」称谓正常 |
| `--settle` 改动回归 | 默认模式对 mock 全绿（87 项 + 5 + 6）；重建默认 dist 与部署包逐字节一致 |

## 已知项（非本轮回归）

- **数据源浏览页不可用态无 h1**：dev 全部 10 个源当前无活连接（catalogs 全 400），explorer 对任何源都落到提前返回的「连接不可用」空态——即备忘在案的两页不可用态缺 h1 存量缺口（`main` 上同样如此）。深链矩阵的唯一失败项即此；mock 矩阵不受影响（mock 源总是可连）。
- 动态质量规则在 dev 为 0 条（`/api/v1/quality/rules` total=0），规则编辑深链在 dev 无真实对应物，本轮矩阵去掉该条，用 `/governance/quality/rules/new`（新建页）覆盖。
- 路由清单里的固定深链 ID（`job-lab-result-001` 等）是 mock 专用 ID，对真实环境要用真实 ID 替换（本轮用 `g2g5-DS全链` 任务与真实源/问题 ID）。

## 工具改动（随本轮提交）

`qa/browser-smoke.mjs` 新增 `--settle <ms>`：路由矩阵在 `main` 出现后的落定等待，默认 600ms 不变；跨网络对真实环境跑矩阵时放宽（本轮 dev 用 2500ms）。断言与步骤不变；对 dev 验证 `--settle` 后，默认模式在 mock 上复跑全绿。

## 环境观察

- 远端磁盘已从 11-18 记录的 95% 降至 4%（200G 盘用 7G）——此前的镜像清理已执行，挂账可销。
- dev 保持 2026-11-17 全量镜像轮的服务端（`0.3.0-main-20261117`），与本轮门户兼容（本轮无服务端契约变化）。

## 回滚口径

`cp -a /root/data-os-dev-rollback-20261126-coss/portal-dist/. /root/data-os-dev-20260803/portal-dist/` 后强刷即可（nginx bind mount 静态服务，无需重启容器；浏览器侧加 cache-buster 防 index.html 缓存）。
