import { randomUUID } from 'node:crypto'
import {
  automaticallyApproveTool,
  type AutoApprovalState,
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

export interface ToolReview {
  decision: 'allow' | 'deny' | 'ask'
  reason: string
}
export type ToolReviewer = (
  request: Omit<ToolApprovalRequest, 'id'>,
  signal: AbortSignal
) => Promise<ToolReview>

export interface ToolApprovalOutcome {
  approved: boolean
  reason?: string
  terminate?: boolean
}

interface PendingApproval {
  request: ToolApprovalRequest
  readOnly: boolean
  manual: boolean
  review?: AbortController
  finish: (outcome: ToolApprovalOutcome) => void
}

/** 权限、提问属于 Runtime 内的会话；父进程只传送用户决定。 */
export class RuntimeInteractions {
  private approvals = new Map<string, PendingApproval>()
  private consecutiveDenials = 0
  private paused = false
  private lastDenied: AutoApprovalState['lastDenied'] = null
  private questions = new Map<
    string,
    { request: UserQuestionRequest; finish: (answers?: UserQuestionAnswer[]) => void }
  >()
  private cancelled = false

  constructor(
    private mode: ToolApprovalMode,
    private readonly changed: () => void,
    private readonly reviewer?: ToolReviewer,
    private readonly reviewTimeoutMs = 30000
  ) {}

  get toolApprovals(): ToolApprovalRequest[] {
    return [...this.approvals.values()].filter(({ manual }) => manual).map(({ request }) => request)
  }
  get autoApproval(): AutoApprovalState {
    return {
      reviewing: [...this.approvals.values()].filter(({ review }) => !!review).length,
      paused: this.mode === 'auto' && this.paused,
      lastDenied: this.lastDenied
    }
  }
  get checkpoint(): { consecutiveDenials: number; paused: boolean } {
    return { consecutiveDenials: this.consecutiveDenials, paused: this.paused }
  }
  restoreCheckpoint(value: unknown): void {
    this.consecutiveDenials = 0
    this.paused = false
    this.lastDenied = null
    if (this.mode !== 'auto' || !value || typeof value !== 'object') return
    const { consecutiveDenials, paused } = value as Record<string, unknown>
    if (
      typeof consecutiveDenials === 'number' &&
      Number.isInteger(consecutiveDenials) &&
      consecutiveDenials >= 0 &&
      consecutiveDenials <= 3 &&
      typeof paused === 'boolean'
    ) {
      this.consecutiveDenials = consecutiveDenials
      this.paused = paused || consecutiveDenials >= 3
    }
  }
  get userQuestions(): UserQuestionRequest[] {
    return [...this.questions.values()].map(({ request }) => request)
  }
  begin(): void {
    this.cancelled = false
    this.lastDenied = null
  }

  approve(
    request: Omit<ToolApprovalRequest, 'id'>,
    readOnly: boolean,
    signal?: AbortSignal
  ): Promise<ToolApprovalOutcome> {
    if (this.cancelled || signal?.aborted)
      return Promise.resolve({ approved: false, terminate: true })
    const id = randomUUID()
    return new Promise((resolve) => {
      const cancel = (): void => finish({ approved: false, terminate: true })
      const finish = (outcome: ToolApprovalOutcome): void => {
        const pending = this.approvals.get(id)
        if (!this.approvals.delete(id)) return
        pending?.review?.abort()
        signal?.removeEventListener('abort', cancel)
        resolve(this.cancelled || signal?.aborted ? { approved: false, terminate: true } : outcome)
        this.changed()
      }
      const pending = { request: { ...request, id }, readOnly, finish, manual: false }
      this.approvals.set(id, pending)
      signal?.addEventListener('abort', cancel, { once: true })
      this.evaluate(pending)
    })
  }

  private manual(pending: PendingApproval, reason?: string): void {
    pending.manual = true
    pending.request.reason = reason
    this.changed()
  }

  private evaluate(pending: PendingApproval): void {
    pending.review?.abort()
    pending.review = undefined
    pending.manual = false
    delete pending.request.reason
    if (automaticallyApproveTool(this.mode, pending.request.toolName, pending.readOnly)) {
      pending.finish({ approved: true })
    } else if (this.mode !== 'auto') {
      this.manual(pending)
    } else if (this.paused) {
      this.manual(
        pending,
        '连续 3 次自动拒绝，当前会话已转为人工审批。切换到其他挡位后重新开启自动批准可恢复。'
      )
    } else {
      const controller = new AbortController()
      pending.review = controller
      this.changed()
      void this.review(pending, controller)
    }
  }

  private async review(pending: PendingApproval, controller: AbortController): Promise<void> {
    // 超时也主动结束等待，兼容未正确响应 AbortSignal 的供应商。
    let timer: ReturnType<typeof setTimeout> | undefined
    let abort: (() => void) | undefined
    try {
      const interrupted = new Promise<ToolReview>((resolve) => {
        abort = () => resolve({ decision: 'ask', reason: '自动审核已取消，请手动确认。' })
        controller.signal.addEventListener('abort', abort, { once: true })
        timer = setTimeout(() => {
          resolve({ decision: 'ask', reason: '自动审核超时，请手动确认。' })
          controller.abort()
        }, this.reviewTimeoutMs)
      })
      const result = await Promise.race([
        Promise.resolve()
          .then(() => {
            controller.signal.throwIfAborted()
            if (!this.reviewer) throw new Error('审核模型不可用')
            return this.reviewer(pending.request, controller.signal)
          })
          .catch((): ToolReview => ({
            decision: 'ask',
            reason: '自动审核暂时不可用，请手动确认。'
          })),
        interrupted
      ])
      if (this.approvals.get(pending.request.id) !== pending || pending.review !== controller)
        return
      pending.review = undefined
      if (result.decision === 'allow') {
        this.consecutiveDenials = 0
        pending.finish({ approved: true })
      } else if (result.decision === 'deny') {
        this.lastDenied = { toolName: pending.request.toolName, reason: result.reason }
        this.consecutiveDenials++
        if (this.consecutiveDenials >= 3) {
          this.paused = true
          // 第三次被拒绝的操作立即交给用户，其他正在审核的调用也转人工。
          for (const current of this.approvals.values()) this.evaluate(current)
        } else {
          pending.finish({
            approved: false,
            terminate: false,
            reason: `自动审核拒绝此次工具调用：${result.reason}\n请调整方案，不要通过改写命令或更换工具绕过拒绝；需要额外授权时询问用户。`
          })
        }
      } else {
        this.consecutiveDenials = 0
        this.manual(pending, result.reason)
      }
    } finally {
      clearTimeout(timer)
      if (abort) controller.signal.removeEventListener('abort', abort)
    }
  }

  respondApproval(id: unknown, approved: unknown): void {
    if (typeof id !== 'string' || typeof approved !== 'boolean')
      throw new Error('无效的工具审批答复')
    const pending = this.approvals.get(id)
    if (!pending?.manual) throw new Error('此工具审批已失效')
    this.consecutiveDenials = 0
    pending.finish({ approved, terminate: !approved })
  }

  setMode(mode: ToolApprovalMode): void {
    if (this.mode === mode) return
    this.mode = mode
    this.paused = false
    this.consecutiveDenials = 0
    this.lastDenied = null
    for (const pending of this.approvals.values()) {
      this.evaluate(pending)
    }
    this.changed()
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
    for (const approval of this.approvals.values())
      approval.finish({ approved: false, terminate: true })
    for (const question of this.questions.values()) question.finish()
  }
}
