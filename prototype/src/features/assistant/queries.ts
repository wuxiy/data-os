import { queryOptions } from '@tanstack/react-query'

import {
  fetchAssistantAdminQuestions,
  fetchAssistantAudits,
  fetchAssistantQuestionEvents,
  fetchAssistantQuestions,
} from '../../data/assistantApi'

/** 问数域 Query：已发布问题、治理清单、事件与审计各自独立失效。 */
export const assistantKeys = {
  all: ['assistant'] as const,
  questions: () => [...assistantKeys.all, 'questions'] as const,
  adminQuestions: () => [...assistantKeys.all, 'admin-questions'] as const,
  events: (code: string) => [...assistantKeys.all, 'events', code] as const,
  audits: (outcome: string, page: number, pageSize: number) => [...assistantKeys.all, 'audits', outcome, page, pageSize] as const,
}

export const assistantQuestionsQuery = () => queryOptions({
  queryKey: assistantKeys.questions(),
  queryFn: ({ signal }) => fetchAssistantQuestions(signal),
})

export const assistantAdminQuestionsQuery = () => queryOptions({
  queryKey: assistantKeys.adminQuestions(),
  queryFn: ({ signal }) => fetchAssistantAdminQuestions(signal),
})

export const assistantQuestionEventsQuery = (code: string) => queryOptions({
  queryKey: assistantKeys.events(code),
  queryFn: ({ signal }) => fetchAssistantQuestionEvents(code, signal),
  enabled: Boolean(code),
})

export const assistantAuditsQuery = (outcome: string, page: number, pageSize: number) => queryOptions({
  queryKey: assistantKeys.audits(outcome, page, pageSize),
  queryFn: ({ signal }) => fetchAssistantAudits(outcome, page, pageSize, signal),
})
