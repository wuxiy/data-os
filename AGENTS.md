# data-os（医数中枢）

医疗数据采集、治理、运营的统一门户。**改代码前先读 [CONTEXT.md](CONTEXT.md)**——领域词汇表（外部运行、通知发件箱、质量引擎、运行模式、患者主索引），评审与设计讨论以其术语为准。

四个子工程：`prototype/`（React 19 + Vite 门户）、`services/control-plane/`（Java 21 / Spring Boot，Maven）、`services/mpi-service/`（Java 21 / Spring Boot，患者主索引独立服务）、`services/quality-runner/`（Python 3.12 / FastAPI + dbt）。部署覆盖在 `deploy/`，架构与验收文档在 `docs/`。

## 命令

```bash
# Java：默认 JDK 是 8，必须显式指 JDK 21，否则报「无效的目标发行版: 21」
cd services/control-plane
JAVA_HOME=$(/usr/libexec/java_home -v 21) mvn test

# mpi-service 同为 Java 21 / Maven（MPI 域术语见 CONTEXT.md「患者主索引」）
cd services/mpi-service
JAVA_HOME=$(/usr/libexec/java_home -v 21) mvn test

# Python：测试用项目内 .venv（pytest / pytest-asyncio / sqlalchemy / PyYAML）
cd services/quality-runner && .venv/bin/python -m pytest tests/ -q

# 前端：所有命令在 prototype/ 下运行；qa 脚本必须从 prototype/ 目录运行（内部按 .. 解析）
cd prototype && npx tsc -b && npx vitest run \
  && node qa/mock-audit.mjs && node qa/portal-interactions-smoke.mjs && npm run build
```

## 语言约定

- 业务文案与 UI 用中文；提交信息用英文（与 git 历史一致）。
- 代码注释：新文件用中文；修改存量英文注释的类时跟随周围英文风格，不强制重写。

## 验收门槛

- 行为保持型重构：既有测试**零修改全绿**（HTTP 面 / API 行为不变）；新功能须带可运行的验证。

按需阅读：

- [架构边界](docs/agents/architecture.md) — 唯一状态机、单一来源清单、仓储拆分；动 `run/` 或做跨栈抽象前必读
- [后端服务](docs/agents/services.md) — 控制面与质量执行器的测试、跨服务契约与红线
- [门户前端](docs/agents/frontend.md) — CSS Modules、演示数据边界、hooks/Drawer、qa 锁规则
