import { describe, expect, it } from 'vitest'
import { routePaths, workPaths } from '../data/routes'
import { portalRoutes, activeNavKey, governanceChildren, routeForPath } from './navigation'

/**
 * 路由覆盖锁：17 个既有入口的 pathname 不重命名、不丢失；
 * 10 个新增工作页模式的路径已登记（FE2–FE5 逐批挂载实现）。
 */
describe('路由登记', () => {
  it('17 个既有入口全部保留原 pathname', () => {
    expect(Object.values(routePaths).sort()).toEqual([
      '/', '/ai-data', '/analysis', '/assets', '/assets/technical', '/assistant', '/assistant/workspace',
      '/data-services', '/delivery-center', '/governance', '/governance/mapping', '/governance/quality',
      '/governance/standards', '/ingestion', '/mpi/review', '/operations', '/operations-center',
    ])
  })

  it('10 个新增工作页模式路径已登记且互不重复', () => {
    const patterns = Object.values(workPaths)
    expect(patterns).toHaveLength(10)
    expect(new Set(patterns).size).toBe(10)
    expect(patterns).toContain('/ingestion/sources/$sourceId/explorer')
    expect(patterns).toContain('/governance/quality/rules/$ruleId/edit')
    expect(patterns).toContain('/assistant/workspace/questions/$questionCode')
  })

  it('导航模型覆盖全部既有入口，且工作页不进入侧栏', () => {
    const navPaths = new Set(portalRoutes.filter((route) => !route.hidden && !route.sub).map((route) => route.path))
    for (const path of Object.values(routePaths)) {
      // 每个既有入口都要能被导航模型解析（可见入口、治理子项或隐藏工作区）。
      expect(portalRoutes.some((route) => route.path === path)).toBe(true)
    }
    // 工作页只参与页签/标题解析，不进入侧栏。
    const literalWorkPaths = Object.values(workPaths).filter((path) => !path.includes('$'))
    for (const path of literalWorkPaths) {
      expect(navPaths.has(path)).toBe(false)
    }
    expect(portalRoutes.filter((route) => route.hidden && route.pattern)).toHaveLength(4)
  })

  it('侧栏高亮归属：深链仍保持父入口激活', () => {
    expect(activeNavKey('/')).toBe('management')
    expect(activeNavKey('/ingestion/jobs/COL-001')).toBe('ingestion')
    expect(activeNavKey('/assets')).toBe('assets')
    expect(activeNavKey('/assets/technical')).toBe('assets')
    expect(activeNavKey('/governance/quality')).toBe('governance')
    expect(activeNavKey('/assistant/workspace/questions/VER-001')).toBe('assistant')
  })

  it('共享入口的页面标题使用独立工作区名称', () => {
    expect(routeForPath('/data-services')?.label).toBe('数据服务')
    expect(routeForPath('/governance/standards')?.label).toBe('数据标准')
  })

  it('治理子导航保留六类入口且不出现重复路由', () => {
    expect(governanceChildren.map((child) => child.label)).toEqual(['治理驾驶舱', '数据标准', '标准映射', '数据质量', '血缘与影响', '数据合同'])
    expect(governanceChildren.filter((child) => child.path === '/governance/quality')).toHaveLength(1)
  })
})
