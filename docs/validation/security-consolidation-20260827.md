# 安全收敛批验收报告（批 A：OM 诊断 + 批 B：S1-S7）— 2026-08-27

> 对应备忘 `docs/deferred-hardening-backlog.md` 安全类 S1-S7；批 A 为用户点名的
> 「OM term 回写（实例修复后）」前置诊断。结论：**S1（4/5，RustFS 需停机窗口）、
> S2/S4/S5/S7 完成，S3 评估后延后（理由在案），P3 诊断定案**；全链收尾健康
> （门户/资产 BFF/AI Data/分析嵌入零回归）。

## 一、验收表

| # | 项目 | 结果 | 证据 |
| --- | --- | --- | --- |
| A（P3 诊断） | OM 实例缺陷定案 | ✅ 诊断闭环 | 三层证据：DB seed 完好（test_definition 35 行）、ES 健康（日常 reindex 正常仅 metric 报错）、**容器重建（全新 JVM）后症状逐字不变**——排除运行态，判为 1.5.11 版本级缺陷，升级（≥1.6）为唯一修复路径；重建后全功能面复验零回归（三库对账 PASS）。G7 registrar / G11 term 回写继续受阻（脚本就绪，升级后启用） |
| S7 | ai-ready 服务间认证切 OIDC | ✅ | Keycloak client `dataos-ai-ready`（service account + **audience mapper**：Keycloak 默认 aud=account 需补）；引擎 issuer 对齐**网关 frontend URL**（token iss=https://…:8443，与内部地址不同）+ JWKS 拉取容内网自签（dev 口径）。实测：OIDC bearer 200、旧静态 token 401、门户 build/evaluate 闭环绿 |
| S2 | .env root 口令清理 | ✅ | `DORIS_PASSWORD` 恢复为 quality_ro 真实口令（经 .env 登录验证 OK，消除「重建容器即断」隐患）；`DORIS_ROOT_PASSWORD` 移至 `/root/.doris-root-pw`（0600）；.env 中旧 root 口令零残留（复检 0） |
| S5 | DM 隔离白名单持久化 | ✅ | `deploy/scripts/edge-isolation-rules.sh`（幂等：172.22/16→DM:5236 ACCEPT、其余容器源 DROP）+ systemd oneshot（enabled，开机重放）；实测重跑零副作用、minifi-edge 零影响、platform-net 容器被阻 |
| S1 | 口令轮换 | ✅ 4/5 | **OM bot secret**（Keycloak regen + 三处引用更新 + assess 闭环验）；**OM demo**（admin reset + 0600 文件）；**Superset spike**（API 面不可用→`superset fab reset-password` CLI + 新口令登录 200 + control-plane 重建 + guest-token 闭环）；**Doris root**（SET PASSWORD + 新口令 OK/旧口令拒）。**RustFS 延后**：AK/SK 被 SeaTunnel 运行中作业定义 + 双服务引用，需停机窗口（残留入备忘） |
| S4 | guest-token 限流 | ✅ | 门户 nginx `limit_req`（10r/m burst 5）：实测首签 200、连打 15 次后 503；repo nginx 源同步 |
| S3 | CSP 收紧 | ⏸ 评估延后 | 现状三层防护在位（同源嵌入 + Referer 白名单 + 仪表盘级 allowed_domains）；显式 frame-ancestors 待生产域名定稿后一并做（G4 曾因 CSP 前置阻断嵌入，不为演示窗口引回归） |

## 二、实施事故与教训（如实）

1. **Secret 轮换漏键引发 BFF 断链**：OM bot secret 有**两个引用键**
   （BFF 的 `DATAOS_OPENMETADATA_CLIENT_SECRET` 与 ai-ready 的
   `DATAOS_OM_INGEST_CLIENT_SECRET`），首轮只更新后者→资产页 503；补齐后恢复。
   教训入备忘：轮换清单须按「键名」逐项打勾。
2. **Superset 轮换两次险情**：脚本失败时空变量经 sed 污染 .env（自伤，从未重启的
   control-plane 容器 env 抢救回旧值）；其 API 面不可用（嵌入端口白名单 + users
   端点 404）最终走 `superset fab reset-password` CLI。教训：**sed 前必须非空守卫**。
3. **nginx 限流三次才成**：zone 须 http 层（该 conf 为 http-include 片段，置于文件顶
   部即可）+ **未引号 heredoc 把 `$binary_remote_addr` 展开为空**（G4 老坑第三次出现，
   nginx 报 invalid number of arguments 才暴露）。两次中断门户均即时回滚恢复。
4. S5 负向验证以「认证超时（被 DROP）」判定；systemd oneshot 当前规则在位为手动
   应用 + 开机重放双保险。

## 三、清账（备忘 S 类状态）

S1→部分（RustFS 残留，需停机窗口）；S2→完成（并入 S1 清账）；S3→评估延后（理由在案）；
S4→完成；S5→完成；S6→未动（生产化批）；S7→完成。P3→诊断定案（升级唯一路径）。
新增运维须知：OM bot secret 轮换引用键清单（两个 env 键 + `/root/.om-ingest-client-secret`）。

## 四、凭据现状底账（不打印值）

- `/root/.doris-root-pw`（root，新）、`/root/.doris-om-ro-pw`、`/root/.doris-ai-writer-pw`、
  `/root/.om-ingest-client-secret`（新）、`/root/.om-demo-pw`（新）、
  `/root/.dataos-ai-ready-client-secret`、`/root/.om-ingestion-bot-pw`（旧，下次收敛处理）
- `.env`（0600）：各专用账号 + Superset/OM bot 新口令；root 口令零残留
- RustFS AK/SK 未变（延后项）
