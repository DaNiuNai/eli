import { randomUUID } from 'node:crypto'
import type { Socket } from 'node:net'
import {
  formatUserQuestionAnswers,
  parseUserQuestionAnswers,
  parseUserQuestions,
  type UserQuestionRequest
} from '../shared/user-question'

/** 与工具审批共用已认证的本机通道，答复始终属于发起它的会话。 */
export class UserQuestions {
  private pending = new Map<string, { request: UserQuestionRequest; socket: Socket }>()

  constructor(private readonly changed: (requests: UserQuestionRequest[]) => void) {}

  ask(toolCallId: unknown, input: unknown, socket: Socket): void {
    if (typeof toolCallId !== 'string' || !toolCallId) throw new Error('无效的提问调用')
    const questions = parseUserQuestions(input)
    const request = { id: randomUUID(), toolCallId, questions }
    this.pending.set(request.id, { request, socket })
    this.publish()
  }

  respond(id: unknown, input: unknown): void {
    const pending = typeof id === 'string' ? this.pending.get(id) : undefined
    if (!pending || pending.socket.destroyed) throw new Error('此提问已失效')
    const answers = parseUserQuestionAnswers(pending.request.questions, input)
    const text = formatUserQuestionAnswers(pending.request.questions, answers)
    this.pending.delete(pending.request.id)
    pending.socket.end(`${JSON.stringify({ answers, text })}\n`)
    this.publish()
  }

  disconnect(socket: Socket): void {
    let changed = false
    for (const [id, pending] of this.pending) {
      if (pending.socket === socket) {
        this.pending.delete(id)
        changed = true
      }
    }
    if (changed) this.publish()
  }

  cancel(): void {
    for (const { socket } of this.pending.values()) {
      if (!socket.destroyed) socket.end(`${JSON.stringify({ cancelled: true })}\n`)
    }
    this.pending.clear()
    this.publish()
  }

  private publish(): void {
    this.changed([...this.pending.values()].map(({ request }) => request))
  }
}
