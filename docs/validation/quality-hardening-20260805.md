# 质量复检闭环最终验收记录

**验收时间**：2026-08-05 10:49–11:00（Asia/Shanghai）
**范围**：质量规则投递、执行批次回写、样本证据、自动关闭/退回、SLA 逾期、责任人通知、桌面门户回归。

## 本地构建与测试

| 项目 | 结果 |
| --- | --- |
| `services/control-plane/mvn -q test` | 34 项通过，failures/errors 均为 0（ControlPlaneApiTest 26、HTTP 质量执行器 1、SeaTunnel 4、运行同步 1、来源检查 2） |
| `services/control-plane/mvn -q -DskipTests package` | 通过；jar SHA-256：`eebeed364d32853bf2cbd82b50d2cd15267910528c7f2f4390c504e9823fc7ca` |
| `prototype/npm run build` | 通过；入口 SHA-256：`441ee73cb577f0fe85c0069bb8bbea737466251a5be1e58d9cce6e8d4c3fb326` |
| 门户资源 | `index-C_iKvHki.js`、`index-C66U1A2d.css`；`deploy/dev/portal-dist/index.html` 与 `prototype/dist/index.html` hash 一致 |
| `node prototype/qa/portal-interactions-smoke.mjs` | 通过 |
| `git diff --check` | 通过 |

## 开发环境部署

- 目标：隔离开发机的 `/root/data-os-dev-20260803`。
- 新建回滚副本：`rollback-pre-final-hardening-20260805-1047`，保存控制面 jar、Docker Compose、Nginx 配置和门户静态包。
- 控制面镜像 digest：`sha256:700889c883ad38c87ce21f9ec568566fa74db207c0b4d804cebe12493a89f254`。
- 远程 `/root/data-os-dev-20260803/control-plane/target/data-os-control-plane-0.1.0-SNAPSHOT.jar` hash 与本地构建一致：`eebeed364d32853bf2cbd82b50d2cd15267910528c7f2f4390c504e9823fc7ca`。
- 门户入口 hash：远程文件与 `curl http://127.0.0.1:18081/` 均为 `441ee73cb577f0fe85c0069bb8bbea737466251a5be1e58d9cce6e8d4c3fb326`。
- 控制面 readiness：`GET /healthz` 返回 `{"status":"UP"}`。
- 质量执行器：`DATAOS_QUALITY_EXECUTOR=DEMO`；提交租约 `120000ms`；通知最大尝试次数 `5`、通知租约 `120000ms`。
- SeaTunnel 未重建，容器 `a91cb39a12622dba4c792e305b68b0926dfb93331f70acf4a015fefbda4172c8` 保持 `running/healthy`，`GET :18082/overview` 返回 2.3.13、1 worker、无运行任务。

## 远程业务验收

所有验收问题使用 `DQ-HARDEN-FINAL-*` 临时数据，脚本退出时清理，最终数据库计数为 0。

- 通过路径：复检投递后同步 1 次得到 `CLOSED`、执行状态 `SUCCEEDED`、`passed=true`、样本证据 1 条、事件 `AUTO_CLOSED`。
- 失败路径：复检投递后同步 1 次得到 `RETURNED`、执行状态 `SUCCEEDED`、`passed=false`、样本证据 1 条、事件 `AUTO_RETURNED`。
- 提醒幂等：同一 `Idempotency-Key` 并发/重复请求最终保留 1 条 `RESPONSIBLE_REMINDER_REQUESTED` 事件和 1 条通知记录。
- 未配置 Webhook：临时通知投递后状态为 `SKIPPED`，未伪造送达。

## 最终浏览器回归

- 页面：`http://127.0.0.1:28082/governance/quality?release=final-hardening`（本地转发至开发门户），标题为“医数中枢 · 医疗数据治理平台”。
- 页面显示“控制面已连接 · 问题与处理记录来自 PostgreSQL”，真实渲染 3 条治理问题。
- 点击“提醒责任人”后，页面显示“已提醒责任人”和“责任人提醒已加入通知队列”；随后删除该精确测试事件/通知。
- 浏览器控制台 `error/warn`：空数组 `[]`。
- 最终截图：[data-os-browser-quality-final-hardening.png](./data-os-browser-quality-final-hardening.png)，SHA-256：`a500314d72e3b498cd91653f629b549c1c81d34572fa152af944c4b5dac5c98b`。

## 回滚

如需恢复部署前版本，将 `rollback-pre-final-hardening-20260805-1047` 中的控制面 jar、`docker-compose.yml`、`nginx.conf` 和 `portal-dist` 恢复到对应目录，重建控制面镜像并执行 `docker compose up -d --no-deps control-plane`、`docker compose up -d --force-recreate portal`。SeaTunnel 数据卷和容器不需要回滚。
