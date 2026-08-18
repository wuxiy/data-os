# 后端服务（control-plane + quality-runner）

## 控制面（Java 21 / Spring Boot / Maven）

- 构建/测试：`cd services/control-plane && JAVA_HOME=$(/usr/libexec/java_home -v 21) mvn test`（默认 JDK 是 8，不指 21 会报「无效的目标发行版: 21」）。
- 集成测试 `ControlPlaneApiTest` 跑在 H2（PostgreSQL 模式）+ Flyway 上——近似而非等价；改 SQL 方言敏感的语句后，如可行应在真实 PostgreSQL 上复核。
- 生产启动校验 `RuntimeConfigurationValidator` 是**运维启动清单**（阻断 DEMO 配置与弱密钥）；「是否配置好」的运行时判定归执行器 adapter，不要塞进它。

## 质量执行器（Python 3.12 / FastAPI + dbt）

- 测试：`cd services/quality-runner && .venv/bin/python -m pytest tests/ -q`（`.venv` 只装测试最小依赖，非完整运行时）。
- 跨服务契约见 `docs/quality-runner.md`：**批次号 == runId == Idempotency-Key**；两侧租约（`stale-run-seconds` 与 `submit-lease-ms`）需协同调参——只调一侧会打开重复执行窗口。
- 新增质量规则：`rules.yml` 登记 + dbt 测试 + 证据查询合同三件套（详见该文档「注册规则」一节）。
