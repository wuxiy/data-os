import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useVisitedTabs } from './visited-tabs'

afterEach(() => { cleanup(); sessionStorage.clear() })

describe('参数页签', () => {
  it('规则编辑和数据源浏览显示对象编号而非固定路径尾段', async () => {
    const { result, rerender } = renderHook(({ path }) => useVisitedTabs(path), { initialProps: { path: '/governance/quality/rules/rule-one/edit' } })
    await waitFor(() => expect(result.current.tabs.some((tab) => tab.label === '编辑质量规则 · rule-one')).toBe(true))
    rerender({ path: '/ingestion/sources/src-two/explorer' })
    await waitFor(() => expect(result.current.tabs.some((tab) => tab.label === '数据源浏览 · src-two')).toBe(true))
  })
})
