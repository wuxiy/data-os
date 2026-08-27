# G9 验收报告：AI Ready Engine MVP — 2026-08-27

对照方案 `docs/ai-ready-g9-review-and-plan-20260827.md`。结论：**8/8 通过**。
`ai-ready-service`（Python 3.12/FastAPI）上线：声明仓库（2 Profile × 10 Requirement）
加载校验、Doris/OM 双探针、6C 加权聚合、Certification Gate（含 Critical 一票否决）；
control-plane `AIReadyEnginePort` 闭环打通（build → 评估 → readiness 回写）；门户版本行
呈现就绪度。**远端首次真实评估结论：Overall 0.8385 → REVIEW_REQUIRED**（7 PASS、
1 WARN、1 FAIL、2 N/A——全部为真实数据面结论，含真实的编码覆盖不足）。

## 一、验收表

| # | 项目 | 结果 | 证据 |
| --- | --- | --- | --- |
| A1 | 声明仓库 | ✅ | `ai-ready/` 27 文件；pytest 契约：10 Requirement 全量可解析、六维覆盖（clean 3/current 1/contextual 1/consumable 1/correlated 1/compliant 3）、双 Profile 引用全集、孤儿声明拒绝 |
| A2 | 可执行性 | ✅ | 远端 medical-rag 实测 10/10 产出结论零执行错误：data_completeness PASS(0.0)、data_freshness **WARN**(159.35h)、mpi_confidence PASS(0.9778)、icd_mapping_coverage **FAIL**(0.843)、semantic_documentation PASS(1.0)、chunk N/A、lineage_completeness PASS(1.0)、pii_classification PASS(1.0)、deidentification PASS(0.0)、patient_split N/A；N/A 项附 G10+ 生效条件 |
| A3 | 评分对拍 | ✅ | pytest 手算锁定：clean=0.6154、overall=0.9231、WARN=0.5、REVIEW 带 0.8、Profile 权重差异（rag 0.6154 vs training 0.625）；远端实测 clean=0.6923 与手算一致 |
| A4 | 一票否决 | ✅ | pytest：满分路径 + critical FAIL（deidentification 明文命中）→ `certification=BLOCKED`、`criticalFailures=[deidentification]`；探针异常按 FAIL 收口（OM 不可达用例） |
| A5 | 幂等与安全 | ✅ | 远端两次 assess 除时间戳外逐字段一致；报告 JSON 无 Doris 口令、无 secret 键名；Doris 检查走只读 `dataos_om_ro`；服务间静态令牌鉴权（401 契约 + 远端无 token 401） |
| A6 | control-plane 闭环 | ✅ | build → 引擎评估 → 摘要返回（overall 0.8385/REVIEW_REQUIRED）→ `readiness_json` 回写（10 项完整报告）+ `build_status=SUCCEEDED`；引擎不可达映射 503 `ADAPTER_UNAVAILABLE`（h2c 排障实测） |
| A7 | CLI | ✅ | 容器内 `python -m app.cli assess clinical-guideline-rag --profile medical-rag --version 1.2.0`：6C 六行 + Overall 0.84 + Result REVIEW_REQUIRED + FAILED 清单——与架构 §34 样式一致 |
| A8 | 回归 | ✅ | control-plane `mvn test` 全量零失败（G8 既有零修改）；ai-ready pytest 19/19；quality-runner pytest 23/23；前端 tsc/vitest/qa/build 全绿；既有链路零影响（OM 三库对账复跑零差异） |

## 二、与方案的偏差（实施实录）

1. **载荷性缺陷——JDK HttpClient 的 h2c 升级被 uvicorn 拒绝后 POST body 丢失**：
   control-plane → ai-ready-service 首次联调 422「body missing」。trace 日志钉死
   （`Unsupported upgrade request` + `http.request body <0 bytes>`）。修复：该
   RestClient 强制 `SimpleClientHttpRequestFactory`（HTTP/1.1）。wget 同容器直发
   200 的隔离实验排除了网络/引擎侧。**排障链**：FastAPI 风格 404（实为 portal nginx
   缓存了 control-plane 旧容器 IP，重启 portal 解决）→ 422 → wget 隔离 → trace。
2. **跨服务 JSON 契约大小写**：引擎 Pydantic 默认 snake_case（`assessed_at`），
   control-plane 读 camelCase——补 Pydantic alias + `model_dump(by_alias=True)`。
3. **OM 列打标 API**：JSON-Patch 列定位须用**索引**（列名被解析为数字 → 500）；
   追加新标签路径 `/columns/{i}/tags/-`；标签须为分类下具体实例（内置
   `PersonalData.Personal`），分类名本身不可直接作 tagFQN。
4. **认证形态**（方案 G9-5 的裁量落地）：OIDC/JWKS 代码在位（issuer 非空启用），
   本批远端用静态共享令牌（`AI_READY_API_TOKEN`）——生产化前切 OIDC 已记入备忘。
5. PyJWT 漏列依赖（首启 ModuleNotFoundError）与 AGENTS.md 注册遗漏均当场补齐。

## 三、部署面留档

- `ai-ready-service:0.1.0-dev`（compose build，声明仓库 baked in）；control-plane
  `0.1.0-ai-ready-g9-20260827`；portal-dist 已更新（就绪度列 + build 摘要 toast）。
- `.env` 新增：`DATAOS_AI_READY_API_TOKEN`（随机）、`DORIS_OM_PASSWORD`、
  `DATAOS_OM_INGEST_CLIENT_SECRET`（引用既有 0600 文件，幂等追加）。
- 数据准备（`om-prepare-ai-ready.sh`，幂等已验）：4 个 PII 列打 `PersonalData.Personal`、
  三库 9 表补中文描述——pii/semantic 探针自此评估真实治理数据。
- 评估样例留存：产品「临床指南 RAG 语料库」v0.1.0 = SUCCEEDED + 0.8385/REVIEW_REQUIRED。

## 四、延后清单（进入 G10）

- 服务间 OIDC 替换静态令牌（备忘 S7）；Requirement 热加载；评估历史（现为版本级单值）
- G10：RAG 数据集工厂（Docling + Data-Juicer + Recipe → `dataos_ai.chunks` 表落地后
  chunk_source_attribution 自动生效）
