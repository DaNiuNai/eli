import { useRef, useState } from 'react'
import type { UserQuestionAnswer, UserQuestionRequest } from '../../../shared/user-question'

export interface UserQuestionDraft {
  selectedOptions: number[]
  otherSelected: boolean
  other: string
}

export interface UserQuestionFormState {
  drafts: UserQuestionDraft[]
  item: string
  submitting: boolean
  failed: boolean
}

function initialState(request: UserQuestionRequest): UserQuestionFormState {
  return {
    drafts: request.questions.map(() => ({ selectedOptions: [], otherSelected: false, other: '' })),
    item: '0',
    submitting: false,
    failed: false
  }
}

export function isUserQuestionAnswered(draft: UserQuestionDraft): boolean {
  return (
    (draft.selectedOptions.length > 0 || draft.otherSelected) &&
    (!draft.otherSelected || !!draft.other.trim())
  )
}

/** 状态留在会话视图外层，消息滚动区切换或重新挂载时仍保留答题进度。 */
export function useUserQuestions(
  onRespond: (sessionKey: string, id: string, answers: UserQuestionAnswer[]) => Promise<boolean>
): {
  stateFor: (request: UserQuestionRequest) => UserQuestionFormState
  updateDraft: (request: UserQuestionRequest, index: number, draft: UserQuestionDraft) => void
  setItem: (request: UserQuestionRequest, item: string) => void
  submit: (sessionKey: string, request: UserQuestionRequest) => Promise<void>
} {
  const [states, setStates] = useState<Record<string, UserQuestionFormState>>({})
  const submitting = useRef(new Set<string>())

  function stateFor(request: UserQuestionRequest): UserQuestionFormState {
    return states[request.id] ?? initialState(request)
  }

  function updateState(request: UserQuestionRequest, patch: Partial<UserQuestionFormState>): void {
    setStates((current) => ({
      ...current,
      [request.id]: { ...(current[request.id] ?? initialState(request)), ...patch }
    }))
  }

  function updateDraft(
    request: UserQuestionRequest,
    index: number,
    draft: UserQuestionDraft
  ): void {
    setStates((current) => {
      const state = current[request.id] ?? initialState(request)
      return {
        ...current,
        [request.id]: {
          ...state,
          drafts: state.drafts.map((value, item) => (item === index ? draft : value))
        }
      }
    })
  }

  async function submit(sessionKey: string, request: UserQuestionRequest): Promise<void> {
    const state = stateFor(request)
    if (submitting.current.has(request.id) || !state.drafts.every(isUserQuestionAnswered)) return
    submitting.current.add(request.id)
    updateState(request, { submitting: true, failed: false })
    try {
      const submitted = await onRespond(
        sessionKey,
        request.id,
        state.drafts.map((draft) => ({
          selectedOptions: draft.selectedOptions,
          ...(draft.otherSelected ? { other: draft.other.trim() } : {})
        }))
      )
      // IPC 确认可能早于下一帧快照；成功后保持锁定，防止旧卡片重复提交。
      if (submitted) return
    } catch {
      // 异常和返回 false 均保留答案，交由下方统一恢复重试状态。
    }
    submitting.current.delete(request.id)
    updateState(request, { submitting: false, failed: true })
  }

  return {
    stateFor,
    updateDraft,
    setItem: (request, item) => updateState(request, { item }),
    submit
  }
}
