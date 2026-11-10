import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installBrowserApiStubs } from '../test-support/browser-apis'

// 2026-11-09 走查 P1 回归锁：日期参数必须「输入即提交值」。
// 旧实现用 DatePicker，手输日期未确认就点「按参数执行」时末字段值不随请求
// 发送，被误判「必填」拒答；本测试模拟该操作序列（第二个日期填完立即执行，
// 不按回车），断言两个参数都随请求提交。
vi.mock('../data/assistantApi', async () => {
  const actual = await vi.importActual<typeof import('../data/assistantApi')>('../data/assistantApi')
  return {
    ...actual,
    fetchAssistantQuestions: vi.fn().mockResolvedValue([
      {
        code: 'medicine-record-daily',
        question: '查询每天的用药记录量',
        aliases: [],
        paramSchema: [
          { name: 'start_date', type: 'date', required: true, description: '开始日期' },
          // 未带 description：走常见参数名兜底映射（dev 真实问题即此形态）。
          { name: 'end_date', type: 'date', required: true },
        ],
        serviceCode: 'medicine-record-daily',
      },
    ]),
    askAssistantQuery: vi.fn().mockResolvedValue({
      answered: true,
      auditId: 'audit-1',
      outcome: 'ANSWERED',
      columns: ['stat_date'],
      rows: [['2026-11-01']],
      truncated: false,
      elapsedMs: 12,
      service: 'medicine-record-daily v1',
      executionPath: 'verified-question -> data-api verified-queries',
    }),
  }
})

import { askAssistantQuery, fetchAssistantQuestions } from '../data/assistantApi'
import { AssistantLive } from './AssistantLive'

afterEach(cleanup)

beforeEach(() => {
  installBrowserApiStubs()
  vi.mocked(fetchAssistantQuestions).mockClear()
  vi.mocked(askAssistantQuery).mockClear()
})

describe('AssistantLive 参数表单', () => {
  it('手输两个日期后立即执行，两个参数都随请求提交（不再丢失末字段）', async () => {
    render(<AssistantLive onNotice={vi.fn()} />)

    const question = await screen.findByText('查询每天的用药记录量')
    fireEvent.click(question)

    const start = await screen.findByLabelText('开始日期')
    const end = screen.getByLabelText('结束日期')
    fireEvent.change(start, { target: { value: '2026-11-01' } })
    fireEvent.change(end, { target: { value: '2026-11-09' } })

    fireEvent.click(screen.getByRole('button', { name: '按参数执行' }))

    await waitFor(() => {
      expect(askAssistantQuery).toHaveBeenCalledWith('查询每天的用药记录量', {
        start_date: '2026-11-01',
        end_date: '2026-11-09',
      })
    })
  })

  it('参数标签优先中文说明；无说明时按常见参数名兜底映射', async () => {
    render(<AssistantLive onNotice={vi.fn()} />)
    fireEvent.click(await screen.findByText('查询每天的用药记录量'))
    expect(await screen.findByLabelText('开始日期')).toBeTruthy()
    expect(screen.getByLabelText('结束日期')).toBeTruthy()
  })
})
