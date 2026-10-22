import { randomUUID } from 'node:crypto'
import {
  automaticallyApproveTool,
  type ToolApprovalMode,
  type ToolApprovalRequest
} from '../shared/tool-approval'
import {
  parseUserQuestions,
  parseUserQuestionAnswers,
  formatUserQuestionAnswers,
  type UserQuestionRequest,
  type UserQuestionAnswer
} from '../shared/user-question'

export interface ToolPolicy {
  decide(
    request: Omit<ToolApprovalRequest, 'id'>,
    readOnly: boolean,
    mode: ToolApprovalMode
  ): 'allow' | 'deny' | 'ask'
}
export const defaultToolPolicy: ToolPolicy = {
  decide: (request, readOnly, mode) =>
    automaticallyApproveTool(mode, request.toolName, readOnly) ? 'allow' : 'ask'
}

/** 权限、提问属于 Runtime 内的会话；父进程只传送用户决定。 */
export class RuntimeInteractions {
  private approvals = new Map<
    string,
    { request: ToolApprovalRequest; readOnly: boolean; finish: (approved: boolean) => void }
  >()
  private questions = new Map<
    string,
    { request: UserQuestionRequest; finish: (answers?: UserQuestionAnswer[]) => void }
  >()
  private cancelled = false

  constructor(
    private mode: ToolApprovalMode,
    private readonly changed: () => void,
    private readonly policy: ToolPolicy = defaultToolPolicy
  ) {}

  get toolApprovals(): ToolApprovalRequest[] {
    return [...this.approvals.values()].map(({ request }) => request)
  }
  get userQuestions(): UserQuestionRequest[] {
    return [...this.questions.values()].map(({ request }) => request)
  }
  begin(): void {
    this.cancelled = false
  }

  approve(
    request: Omit<ToolApprovalRequest, 'id'>,
    readOnly: boolean,
    signal?: AbortSignal
  ): Promise<boolean> {
    if (this.cancelled || signal?.aborted) return Promise.resolve(false)
    const decision = this.policy.decide(request, readOnly, this.mode)
    if (decision !== 'ask') return Promise.resolve(decision === 'allow')
    const id = randomUUID()
    return new Promise((resolve) => {
      const cancel = (): void => finish(false)
      const finish = (approved: boolean): void => {
        if (!this.approvals.delete(id)) return
        signal?.removeEventListener('abort', cancel)
        resolve(approved && !this.cancelled && !signal?.aborted)
        this.changed()
      }
      this.approvals.set(id, { request: { ...request, id }, readOnly, finish })
      signal?.addEventListener('abort', cancel, { once: true })
      this.changed()
    })
  }

  respondApproval(id: unknown, approved: unknown): void {
    if (typeof id !== 'string' || typeof approved !== 'boolean')
      throw new Error('无效的工具审批答复')
    const pending = this.approvals.get(id)
    if (!pending) throw new Error('此工具审批已失效')
    pending.finish(approved)
  }

  setMode(mode: ToolApprovalMode): void {
    this.mode = mode
    for (const pending of this.approvals.values()) {
      const decision = this.policy.decide(pending.request, pending.readOnly, mode)
      if (decision !== 'ask') pending.finish(decision === 'allow')
    }
  }

  ask(
    toolCallId: string,
    input: unknown,
    signal?: AbortSignal
  ): Promise<{ answers: UserQuestionAnswer[]; text: string }> {
    if (this.cancelled || signal?.aborted) return Promise.reject(new Error('用户已停止此次提问'))
    const request = { id: randomUUID(), toolCallId, questions: parseUserQuestions(input) }
    return new Promise((resolve, reject) => {
      const cancel = (): void => finish()
      const finish = (answers?: UserQuestionAnswer[]): void => {
        if (!this.questions.delete(request.id)) return
        signal?.removeEventListener('abort', cancel)
        if (answers)
          resolve({ answers, text: formatUserQuestionAnswers(request.questions, answers) })
        else reject(new Error('用户已停止此次提问，不要视为已获得答案'))
        this.changed()
      }
      this.questions.set(request.id, { request, finish })
      signal?.addEventListener('abort', cancel, { once: true })
      this.changed()
    })
  }

  respondQuestion(id: unknown, input: unknown): void {
    const pending = typeof id === 'string' ? this.questions.get(id) : undefined
    if (!pending) throw new Error('此提问已失效')
    pending.finish(parseUserQuestionAnswers(pending.request.questions, input))
  }

  cancel(): void {
    this.cancelled = true
    for (const approval of this.approvals.values()) approval.finish(false)
    for (const question of this.questions.values()) question.finish()
  }
}
