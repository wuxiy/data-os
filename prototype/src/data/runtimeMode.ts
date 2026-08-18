/**
 * 运行模式（领域定义见 CONTEXT.md「运行模式」）：门户演示/真实差异的
 * 单一来源。页面消费这里的语义判断，不散布布尔分支。
 *
 * 演示数据是构建期显式开关：生产构建必须保持未设置（或 false），
 * 静态演示记录才不会被误认为真实来源；本地验收用
 * `VITE_DATAOS_DEMO_MODE=true npm run dev` 显式开启。
 */
export const frontendDemoMode = String(import.meta.env.VITE_DATAOS_DEMO_MODE ?? '').toLowerCase() === 'true'

/** 后端亦声明 DEMO 时整个门户按演示呈现：两个真相源在此合一。 */
export function isDemoRuntime(backendMode: string | null | undefined): boolean {
  return frontendDemoMode || backendMode === 'DEMO'
}

/** 静态样例（责任链、趋势图等）仅在「演示构建且控制面可用」时展示。 */
export function showStaticSamples(apiState: 'loading' | 'live' | 'unavailable'): boolean {
  return frontendDemoMode && apiState === 'live'
}

/** 演示（FakeSource）模板是否进入任务模板目录。 */
export function offersDemoTemplate(): boolean {
  return frontendDemoMode
}

/** 模板键在当前模式下是否允许保存（真实模式拒绝演示模板）。 */
export function allowsTemplate(templateKey: string, demoTemplateKey: string): boolean {
  return frontendDemoMode || templateKey !== demoTemplateKey
}

/** 新任务的默认模板键：演示给 FakeSource，真实给自定义 JSON。 */
export function defaultTemplateKey(demoTemplateKey: string, liveTemplateKey: string): string {
  return frontendDemoMode ? demoTemplateKey : liveTemplateKey
}

/** 管理驾驶舱的演示快照时间标签（真实模式无静态快照可标）。 */
export const demoSnapshotAsOf: string | null = frontendDemoMode ? '08-01 14:30（演示快照）' : null

/** 管理驾驶舱流程面板的快照文案。 */
export const demoFlowSnapshotLabel: string = frontendDemoMode ? '演示快照 · 08-01 14:30' : '等待首个控制面快照'

/** 页头时间戳：有值标「截至」，否则按运行模式给出占位文案。 */
export function timestampPlaceholder(asOf: string | null): string {
  if (asOf) return `截至 ${asOf}`
  return frontendDemoMode ? '演示数据快照' : '等待首个快照'
}
