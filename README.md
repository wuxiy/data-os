# data-os（医数中枢）

医疗数据采集、治理、运营的统一门户。底层以 SeaTunnel、Doris、OpenMetadata、HAPI FHIR 等开源组件作为可替换执行器，甲方用户只面对统一的中文业务门户，不接触组件原生控制台。

## 文档地图

- `docs/medical-data-platform-blueprint.md`：平台架构蓝图（已批准）——组件选型、数据分层、门户页面、部署档位、交付路线与安全合规。
- `DESIGN.md`：第一版原型的视觉设计系统（色彩、字体、组件规则）。
- `prototype/`：React + Vite 高保真桌面原型，路由与数据说明见其 `README.md`。
- `tasks/`：执行计划与结果复盘（`todo.md`）、经验教训（`lessons.md`）。

## 当前状态

- 架构蓝图已定稿并通过评审，实现前待落定的架构决策门列在蓝图第 15 节。
- 前端原型已完成 6 个页面：管理驾驶舱、治理驾驶舱、数据标准、标准映射、质量闭环、主索引审核；其余 7 页顺延下一轮。
- 后端与平台控制面尚未开始实现。

## 运行原型

```bash
cd prototype
npm install
npm run dev
```

生产构建与路由回退要求见 `prototype/README.md`。
