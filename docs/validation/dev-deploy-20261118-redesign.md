# dev 环境部署记录 · 2026-11-18（门户重设计轮，静态包增量）

> 提交基线：`cc6af79`（main，与 origin/main 一致）｜执行：仅静态包替换，镜像/容器/`.env` 不动
> 回滚目录：`/root/data-os-dev-rollback-20261118-redesign`（旧 portal-dist + sha256）

## 变更内容

| 对象 | 旧 | 新 |
| --- | --- | --- |
| portal-dist | `2e85cc03…`（`2b63cb8` 构建，2026-11-17 align 轮） | **`ab17244b…`（`cc6af79` 构建，47 文件，`index-Bn0zpgAj.js`）** |
| 容器/镜像/`.env` | 不动 | 不动（本轮纯前端 + 文档） |

内容为 `cc6af79` 门户极简重设计：工作台与质量反馈改版（统一导航、指标、表格与表单视觉语言；质量工作台 1280px 保留问题/处理/证据三栏），含 DESIGN.md 约定与测试补充。

## 验证证据

| 检查 | 结果 |
| --- | --- |
| 本地门槛 | tsc + vitest 120 用例 + mock-audit + portal-interactions-smoke + build 全绿（CI 另有 5 job 绿，推送时已过） |
| 部署守卫 | dist 无 env 文件；bundle 无 `data-platform` OIDC 门串、无 `VITE_DATAOS_DEMO_MODE` |
| 三处 hash | 本地构建 = 远端宿主 = HTTP `ab17244bfcfb37c9dbc255da4b7e960c6244312d64a4e4ffe51d9ee324d44b73`；HTTP 引用 `index-Bn0zpgAj.js` 与本地一致 |
| 上传完整性 | 远端 47 文件（`COPYFILE_DISABLE=1` 流式 tar；macOS xattr 扩展头警告无害，文件数与本地一致、无 AppleDouble） |
| 路由矩阵 | browser-smoke 全集 29 条路径 HTTP 全 200 |
| 真实 API | system/status DEMO（dev 种子口径）READY 3/3；MPI 2882 身份/352 黄金人/1126 待复核；sources（含 11-17 冒烟残留源）、governance issues 正常 |
| 浏览器矩阵 | 本机 Chrome 对 `http://172.16.65.59:18081` 跑 6 路由 × 2 宽度 12 项全过（无 console 异常、无横向溢出） |
| 新视觉目检 | 截图核验：总览页新指标带 + 优先处理/最近事件两栏；质量页 1280px 三栏（问题/处理/证据）如 DESIGN.md 约定渲染，真实数据（4 治理问题、徽标 1126）正常 |

## 环境观察（非回归）

- 远端磁盘 95%（4.3G free），本轮仅新增回滚目录一份静态包（~2MB 级），未新增镜像层；镜像清理仍待用户明示。
- `/ingestion/new` 合成 PostgreSQL 源连接拒绝（127.0.0.1:5432）为 2026-11-17 已记录的 dev 数据条件，未变化。

## 回滚口径

`cp -a /root/data-os-dev-rollback-20261118-redesign/portal-dist/. /root/data-os-dev-20260803/portal-dist/` 后强刷即可（nginx bind mount 静态服务，无需重启容器；浏览器侧加 cache-buster 防 IAB 缓存 index.html）。
