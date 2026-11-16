# 总览概念图生成记录

使用内置 imagegen 生成，原图为 `00-concept.png`。最终审核以 `review.html` 的可交互原型及浏览器截图为准；概念图未进入正式门户。

```text
Use case: ui-mockup.
Asset type: high-fidelity desktop web app design review, one complete 1440x900 first viewport, large landscape image.
Primary request: Design the "医数中枢" hospital data operating portal, borrowing the restrained shadcn admin language of Continew UI Next: light neutral inset sidebar, slim 48px top header with small visited-page tabs centered INSIDE the header, cool blue primary actions, white continuous data tables. This is a dense professional hospital information-center workspace, not a marketing page.
Composition: 256px light gray left sidebar, small blue four-pane logo next to 医数中枢, workspace switcher 综合医院 · 数据中心. Group navigation into 工作概览 (总览 selected, 运营中心, 交付中心), 数据管理 (数据接入, 数据资产, 数据治理, 患者主索引), 数据应用 (数据服务, 分析看板, AI Data, 智能问数), 平台管理. Black/gray text and real thin-line icons. Tiny footer user avatar.
Header: sidebar toggle, search icon, centered compact visited tabs 总览 / 数据接入 / 数据质量 / 数据资产, right notification bell and simple circular avatar. Subtle gray border.
Main: pale neutral canvas, 24px gutters, small breadcrumb 工作概览 / 总览. Top title 医院数据运营总览 in clear 24px sans, subtitle 从数据接入到可信使用，掌握每一条数据链路. At right date 最近7天 and blue button 查看待办. A small but readable label 审核原型 · 合成数据 on the title line.
Below: four equal white summary rectangles with gray 1px border and 8px corner radius, no gradients, no oversized decorative icons. Metric text 接入数据源 12, 今日采集记录 128.6万, 质量规则通过率 98.4%, 待处理事项 18. Smaller supporting values and thin subtle icons.
Next row: wide (two-thirds) white card titled 数据链路概览, with real blue dual-line timeseries chart across 7 days, tiny blue line legend 采集记录 and gray line 质量通过率, thin dotted gridlines, restrained numerical axes. Right third: 待办事项 with three separated numbered rows, 数据质量问题 8 待处理 (small amber), 主索引人工复核 6 待复核, 数据合同待确认 4 待处理, each with right chevron.
Bottom: two-thirds white actionable table 优先处理 with four precise rows, columns 问题/类型/责任部门/状态/操作. Rows 药品编码不符合院级标准 / 患者证件号完整性校验 / 门诊处方采集运行异常 / 就诊记录关联缺失; muted red/amber small flat statuses, blue text 处理. Right narrow card 最近事件 with 3 timeline records and small timestamps.
Style: pixel-perfect realistic shadcn application screenshot, Noto Sans SC style Chinese typography, white and #f7f8fa light gray, #3b74e7 muted cool blue, near-black #202327 body text, subtle #e6e8eb borders. 13px readable Chinese body, 12px labels, 24px titles, 28px numerals. 6-8px controls radius, 32-36px controls. Cards used only for major work areas. No dark sidebar, no glossy gradients, no glass, no floating pill buttons, no hero artwork, no 3D, no watermark. All content is synthetic review data and label must be visible. Keep all text sharp and fully in frame.
```
