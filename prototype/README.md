# 医数中枢第一版前端原型

面向医院信息中心与数据治理人员的桌面端可点击原型。首版覆盖管理驾驶舱、治理驾驶舱、数据标准、标准映射、数据质量闭环和主索引候选审核。

## 运行

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run build
npm run preview
```

## 核心路由

- `/`：医院数据运营总览
- `/governance`：治理驾驶舱与责任链
- `/governance/standards`：数据标准
- `/governance/mapping`：标准映射
- `/governance/quality`：质量问题闭环
- `/mpi/review`：主索引候选审核

部署到静态服务器时，需要将以上前端路由统一回退至 `index.html`。

## 责任链来源

责任链通过 `issueId → assetId → ruleId → ownerId → ticketId` 关联生成：异常来自质量规则运行结果，数据对象来自资产目录与采集元数据，治理规则来自规则中心，责任部门来自资产责任人与组织主数据，处理结果来自治理工单。

当前数据位于 `src/data/mock.ts`。接入后端时，建议保持页面组件的展示模型不变，将 mock 数据替换为按页面聚合的 BFF/API 响应，避免前端直接拼接五类治理来源。
