import type { Plugin } from '@deepseek-ai/cordis'
import type { GenerateOptions, RequestMessage } from '@deepseek-ai/dsh-llm'
import { sessionState } from './messages'

/** 摘要请求保留文字和工具序列；二进制媒体留在原始会话与附件存储中。 */
export const compactionPolicy: Plugin = {
  inject: ['llm', 'sessions'],
  apply(ctx) {
    const prepared = new WeakSet<GenerateOptions>()
    ctx.on('llm/stream', (options, next) => {
      if (options.purpose !== 'compaction' || prepared.has(options)) return next()
      const session = options.sessionId ? ctx.sessions.get(options.sessionId) : undefined
      const start = session?.snapshotEvents().findLast((event) => event.type === 'compaction/start')
      const state =
        session && start?.type === 'compaction/start' && start.data.turn === null
          ? (sessionState(session, 'eli.compaction-request') as
              { instructions?: string } | undefined)
          : undefined
      const messages: RequestMessage[] = options.messages.map((message) => ({
        ...message,
        content: message.content.map((part) =>
          part.type === 'image' || part.type === 'file'
            ? {
                type: 'text' as const,
                text: '[摘要请求省略媒体，保留相关文字分析；原始内容仍保存在会话中。]'
              }
            : part
        )
      }))
      if (state?.instructions)
        messages.push({ role: 'user', content: [{ type: 'text', text: state.instructions }] })
      const request = { ...options, messages }
      prepared.add(request)
      return ctx.llm.stream(request)
    })
  }
}
