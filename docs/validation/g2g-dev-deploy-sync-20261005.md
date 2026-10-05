# dev 部署同步 · G2G 批次 3/4/5 真实链路核验（欠账关账）

- 日期：2026-10-05
- 范围：G2G 跨批 dev 欠账集中清单的 **A 组三项**（批次 3 评分 / 批次 4 边缘域 / 批次 5 DS 调度链）；B 组（认证策略）维持待用户裁决
- 结果：**通过**（V25-V27 真实 PG 迁移 28 全绿；批次 3/4/5 全部在 dev 真实组件上闭环；实抓两处真缺陷当场修复）

## 部署内容

| 组件 | 镜像 | 变更 |
| --- | --- | --- |
| control-plane | `0.2.0-g2g-20261005` | V22-V27 六迁移（批次 1-4）+ edge/schedule/score 三域 |
| quality-runner | `0.2.0-g2g-20261005` | rulegen/score/edge_watermark 三批变更 + db.py 类型修复 |
| portal dist | 热更 | G2G 批次 1-5 全部门户面（含构建守卫：无 .env.production、bundle 无 8443/realms 串） |
| DolphinScheduler | 镜像不动，**补 8 个任务插件 jar** | shell/sql/python/http/datax/flink/spark/factory → api/master/worker 三容器 |

守卫齐：镜像内 jar 迁移清单核对（G27 坑防复发）、构建上下文含 edge_watermark/rulegen/score 新模块核对。

## 实抓真缺陷两处（本地测试无法暴露、dev 真实 PG 当场炸出）

1. **V25 用 `DOUBLE` 类型**：H2 PostgreSQL 方言容忍、真实 PG 报 `type "double" does not exist` → 控制面启动 crash-loop。修复为 `DOUBLE PRECISION`（V25 两处）；**同坑第二处实例在 runner `db.py`**（`quality_runner_runs.score DOUBLE`）→ 同修。本地 53/53 与 mvn 全绿复验通过后重建镜像。
   教训升级：**`DOUBLE` 是 H2-only 陷阱的完整家族**（G27 的「拷预构建 jar」是部署时点坑，这是 SQL 方言坑），两处都在「本地全绿、真实 PG 即炸」区间——全仓迁移/DDL 已扫净（无第三处）。
2. **dev DolphinScheduler 无任何任务插件**（部署债 8 周）：api/master/worker 只有 task-api/executor 引擎壳，`plugins/` 目录空，`Cannot find TaskChannel for : SHELL`——8 周来 DS 只当过状态探针（G23 只读契约、健康卡），从未真正建过工作流，故从未暴露。从 Maven Central 拉 8 个插件 jar 分发三容器后恢复。

## 真实链路验收（全部走 dev 真实组件与真实数据）

### 批次 3 · 评分
- V25 默认评分标准落真实 PG：`GET /api/v1/quality/score/standard` → passScore 60、六维等权、四级等级——中文键值完整往返。

### 批次 4 · 边缘域
- 节点登记（127.0.0.1:18081 → 在线探测真实 TCP 回写）+ 列表 200；
- **水位卡真实数据**：`GET /v1/edge/nodes/watermarks` → runner 直连真实 Doris：`ods_ep.ep_mz_cfzb_edge` 11,375 行 / `ep_mz_ypcfmx_edge` 12,219 行，最近写入 2026-08-20 16:28（近 7 天无入仓为真实状态——边缘链路 8 月后停写，如实呈现）。

### 批次 5 · DS 调度链（真实 DolphinScheduler 3.4.1）
- 真实工作流：DS 里新建 `g2g5-schedule-check`（SHELL 任务）并发布 ONLINE（code 186097802226016）；
- 控制面绑定 → **预览走 DS 引擎计算**（`source:"DS"`，未来 5 次 02:30，Asia/Shanghai→UTC 换算正确）；
- 保存调度 → **DS `t_ds_schedules` 出现真实行**（id=2，crontab `0 30 2 * * ?`）→ 上线 release_state=1（ONLINE）→ 视图 online=true → 下线/删除 200/204 → 重建并留一条上线中（门户演示资产）；
- 实例列表实时代理 200（0 条为真实状态——还没到触发时刻）。

### 过程坑（全部当场修复并固化）

1. **DS 3.4.1 认证语义**：header `token` 不是登录 sessionId，而是 `t_ds_access_token` 长期 API token（`UserMapper.queryUserByToken` 联表 + expire_time 比对；session 表 2 小时 TTL 与其无关）——给 admin 发 30 天 API token（不回显，存 dev /tmp 0600）。
2. **DS 3.4.1 API 路径是 `workflow-definition` 单数**（本仓 DS 客户端按 3.4 命名代写成复数+process 兜底——运行面用到的 `schedules`/`workflow-instances`/`executors` 路径在 3.4.1 实测全部正确；单复数差异只影响任务开发面，门户不做，无代码变更需要）。
3. **workflow-definition 创建参数**：`timeout`/`executionType` 为 service 签名必填（openapi schema 验证定位）。
4. **GitHub 大文件断流**（dbt-core-experimental-parser 构建后端拉 55MB wheel 反复超时）：Mac 侧下载 → wheels/ 进构建上下文 → pip 本地安装 + pyproject 钉版本绕 GitHub；**Dockerfile 的 wheels 层为可选形态**（上下文无 wheels/ 时行为不变）。
5. **控制面切换后 portal 502**：nginx 缓存旧容器 IP（G17/G20 老坑第三次重现）——重启 portal 即愈。

## 与批次 7 交付的联动

批次 5 验收期间的 DS API token 与种子/冒烟共存无冲突；dev 认证矩阵（docs/deploy-auth-matrix.md）无需变更（DS 走自有 token 体系）。

## 余量

- B 组三项（dev 切 ENFORCED / 控制面→MPI OIDC client / 生产 realm 服务间种子）维持待用户裁决。
- DS 插件修复是**运行时容器内操作**（docker cp + restart），compose 重建后会丢失——已记入 backlog（候选：deploy/dev/dolphinscheduler compose 加插件挂载卷或自建镜像，0.5 人日）。
