# Gate 13 验收报告：ToB 数据 API（数据服务面）

> 日期：2026-08-27
> 方案：`docs/tob-data-api-g13-review-and-plan-20260827.md`
> 阶段定位：核心职责 4「完善 ToB 端 API 接口」

## 一、交付物

| 层 | 内容 |
| --- | --- |
| 管理面（control-plane） | `dataservice` 域：V13 三表（`data_service` / `data_service_key` / `data_service_call`）、`SqlTemplateValidator` 静态校验、DRAFT→PUBLISHED→DEPRECATED 状态机、Key 发放（SHA-256 只存 hash）/吊销、幂等审计、registry 投影；`/api/v1/data-services` 管理端点 + `/internal/data-api` 执行面端点 |
| 执行面（`services/data-api`） | FastAPI 网关：X-API-Key 认证（registry 30s 缓存匹配 hash）、参数契约校验、医院行级授权、`:name` 占位有序绑定 pymysql、maxRows 截断、read/write timeout、稳定错误码（401/403/429/400/503）、尽力而为审计回写 |
| 门户 | `/data-services` 数据服务工作台：概览带、创建/发布/下线、参数与列契约、curl 调用示例、Key 发放（一次性明文）/吊销、调用审计表 |
| 部署 | Doris `dataos_api_ro`（6 表 SELECT + compute group USAGE）、compose `data-api` 段、nginx `/dataapi` 反代（strip 前缀）、种子脚本（3 服务 + 3 Key） |

## 二、验收清单（16/16 全过）

| # | 项 | 证据 |
| --- | --- | --- |
| 1 | 管理面全绿 | `mvn test` 182/182（含 DataApi 域 20 个新测试；V13 真 PG 迁移成功 `now at version v13`） |
| 2 | 执行面全绿 | `pytest` 16/16（认证/授权/配额/参数/注入/截断/审计契约） |
| 3 | 门户全绿 | tsc + vitest 14 + mock-audit + interactions-smoke + build |
| 4 | Doris 只读账号 | `dataos_api_ro` 查 `ods_ep.ep_mz_cfzb` 11442 行 OK；查 `dataos_ai.chunks` Access denied；SHOW GRANTS 授权面=6 表+compute group |
| 5 | ToB 真实闭环 | `POST /dataapi/v1/services/prescription-daily-summary/query` → 11 个日行（2026-08 真实处方汇总），52ms |
| 6 | PHI 守卫 | `research-cohort-masked` 响应 columns=[patient_id, hospital_code, gender, birth_date, quality_score, consent_status]，无 name/id_card |
| 7 | 限额与截断 | maxRows=1 时 rowCount=1 truncated=true；无 Key 401 `API_KEY_REQUIRED`；错 Key 401；跨服务 Key 403 `SERVICE_NOT_AUTHORIZED`；quota=1 用尽 429 `QUOTA_EXCEEDED` |
| 8 | 参数面 | 未声明参数 400 `PARAM_INVALID`（`未声明的参数: evil`）；未授权医院 403 `HOSPITAL_NOT_AUTHORIZED`（Key 授 rjy 传 wh） |
| 9 | 审计闭环 | 管理端点可见 200（rowCount=11, elapsedMs=52）与 400 记录，keyId 归因；overview（3 服务/3 Key/当日 10 调用） |
| 10 | 隔离性 | data-api 容器内直查 11 行（进程自包含）；门户重启窗口 5 连发 4 成（仅共享 nginx 入口瞬断，服务本体不受影响） |
| 11 | p360 汇总 | `patient-360-stats` 返回 rjy 聚合（52351 患者，36ms），无患者明细行 |
| 12 | 门户新面 | `index-DeEoHJui.js` 上线；导航「数据服务」路由激活 |

## 三、实施事故与偏差（如实）

1. **远端 .env 的 `DATAOS_CONTROL_PLANE_IMAGE` 三处旧值**：append 新值不生效（compose 取先出现
   的键），control-plane 起了 g12 旧镜像——V13 未迁移、表缺失暴露问题。修正：sed 全量替换。
   教训：远端 .env 重复键要在原位改，不要 append。
2. **H2 不支持 `ON CONFLICT DO NOTHING`**（DO UPDATE 形态可行）：幂等改为先查后插，
   语义不变（测试断言第二次回写 false 验证）。
3. **seed 脚本 PG 容器名猜错**（control-plane 复用 keycloak-db）：首跑实际未落库却打印
   成功（docker usage 噪声掩盖）。以 registry 404 发现，直插修正；脚本留档待下次批次
   参数化容器名。
4. **Pydantic 参数模型过窄**（dict[str, str] 拒绝数值参数）：实测 min_quality_score=0 被
   422，放宽为 dict[str, Any] 并补镜像热更新后复测通过。
5. **门户产物同步错路径**（deploy/dev/portal-dist vs 根 portal-dist 挂载）：以旧资产
    index-CC4VMsB0 发现，重同步修正。
6. **OIDC client `dataos-data-api` 本批未建**：dev control-plane 为 AUTH_MODE=DISABLED，
   /internal 直通——静态内部令牌满足 data-api 启动校验即可。切 ENFORCED 时按 S7 模式补
   client + audience mapper（键位已在 compose 预留）。

## 四、安全口径（本批）

- API Key 明文三处 0600（`/root/.data-api-demo-key`、`.data-api-cohort-key`、`.data-api-p360-key`），
  库内仅 SHA-256 hash；Doris 口令 `/root/.data-api-ro-pw` 0600 + .env 0600。
- SQL 模板静态校验（SELECT-only/无分号/无 DML/占位一致）+ 参数绑定传输，无拼接。
- PHI 守卫：模板层不引用 name/id_card 列（响应字段断言验证）。
- /internal/data-api 在 DISABLED 模式下内网直通（与 /api 同水平），ENFORCED 切换项入备忘。

## 五、延后清单（入备忘）

- 大结果集异步导出至对象存储（§5.8 完整形态）→ 备忘 P7
- /internal 强制 OIDC 服务 token（control-plane 切 ENFORCED 批）→ 备忘 S8
- 审计回写失败持久化缓冲、网关级全局限流、调用方自助门户、合同变更通知 → 方案 §九
