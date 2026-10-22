import { createConnection } from 'node:net'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { configureTerminal } from './terminal'

interface ApprovalChannel {
  port: number
  token: string
}

function requestDesktop(
  channel: ApprovalChannel,
  message: Record<string, unknown>,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port: channel.port })
    let body = ''
    let settled = false
    const finish = (reply?: Record<string, unknown>, error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(connecting)
      signal?.removeEventListener('abort', abort)
      socket.destroy()
      if (error) reject(error)
      else resolve(reply ?? {})
    }
    const abort = (): void => finish(undefined, new Error('用户已停止此次提问'))
    const connecting = setTimeout(
      () => finish(undefined, new Error('无法连接 eli 工具交互服务')),
      10_000
    )
    socket.setEncoding('utf8')
    socket.on('connect', () => {
      clearTimeout(connecting)
      socket.write(`${JSON.stringify({ ...message, token: channel.token })}\n`)
    })
    socket.on('data', (chunk) => {
      body += chunk
      if (Buffer.byteLength(body, 'utf8') > 4 * 1024 * 1024) {
        finish(undefined, new Error('工具交互答复过大'))
        return
      }
      if (!body.includes('\n')) return
      try {
        const reply = JSON.parse(body.slice(0, body.indexOf('\n')))
        if (!reply || typeof reply !== 'object' || Array.isArray(reply)) {
          throw new Error('无效的工具交互答复')
        }
        finish(reply)
      } catch {
        finish(undefined, new Error('无效的工具交互答复'))
      }
    })
    socket.on('error', () => finish(undefined, new Error('工具交互连接已断开')))
    socket.on('close', () => finish(undefined, new Error('工具交互连接已断开')))
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
  })
}

const questionParameters = Type.Object({
  questions: Type.Array(
    Type.Object({
      header: Type.String({ minLength: 1, maxLength: 12, description: '界面小胶囊的短标签' }),
      question: Type.String({ minLength: 1, maxLength: 2000, description: '完整、清楚的问题' }),
      multiSelect: Type.Boolean({ description: 'true 为多选，false 为单选' }),
      options: Type.Array(
        Type.Object({
          label: Type.String({ minLength: 1, maxLength: 200 }),
          description: Type.String({ minLength: 1, maxLength: 2000 }),
          preview: Type.Optional(
            Type.String({
              minLength: 1,
              maxLength: 20000,
              description: '仅单选可用的 Markdown 预览'
            })
          )
        }),
        { minItems: 2, maxItems: 4 }
      )
    }),
    { minItems: 1, maxItems: 4 }
  )
})

/** 使用 PI 的执行前钩子，直接调用、MCP 及 codemode 嵌套调用均经过审批。 */
export default function toolApproval(pi: ExtensionAPI): void {
  pi.registerFlag('eli-approval-channel', { type: 'string' })
  pi.registerFlag('eli-terminal', { type: 'string' })
  let channel: ApprovalChannel | undefined
  pi.on('session_start', async (_event, ctx) => {
    configureTerminal(pi, ctx.cwd)
    const next: ApprovalChannel = JSON.parse(String(pi.getFlag('eli-approval-channel')))
    channel = next
    if (!(await requestDesktop(next, { type: 'ready' })).approved) {
      channel = undefined
      throw new Error('无法连接 eli 工具审批服务')
    }
  })
  pi.registerTool({
    name: 'ask_user_question',
    label: '询问用户',
    description: `向用户展示可交互的选项卡片，并等待用户答复后继续。

什么时候用：只在被一个真正属于用户的决定卡住时使用。有惯例默认值的事情，或能自行查证的事实，应自行决定并说明，不要询问。

提问的形态：一次 1–4 个问题，每题 2–4 个选项。选项应互斥，除非 multiSelect 为 true。用户永远可以选“其他”自由输入，不要把“其他”作为模型选项重复提供。若有推荐项，将它放在第一个，并在 label 末尾加“(推荐)”。header 是最多 12 字符的短标签，用作界面小胶囊。multiSelect 为 true 表示多选，false 表示单选。

预览（preview）：需要直观对比具体产物时，如 ASCII 界面草图、实现代码、图表方案或配置示例，可为选项提供 Markdown preview。至少一个选项有 preview 时，界面显示左右分栏对比，预览使用等宽框。简单偏好问题不要用 preview；preview 只支持单选。工具返回用户选择、自定义答案，以及选中选项的预览。`,
    promptSnippet: '询问真正需要用户决定的问题，展示单选或多选卡片并等待答复。',
    parameters: questionParameters,
    executionMode: 'sequential',
    annotations: { readOnlyHint: true },
    async execute(toolCallId, params, signal) {
      if (!channel) throw new Error('用户提问服务未连接，请重新连接')
      const reply = await requestDesktop(
        channel,
        { type: 'user_question', toolCallId, input: params },
        signal
      )
      if (typeof reply.error === 'string') throw new Error(reply.error)
      if (reply.cancelled) throw new Error('用户已停止此次提问，不要视为已获得答案')
      if (typeof reply.text !== 'string' || !Array.isArray(reply.answers)) {
        throw new Error('无效的用户提问答复')
      }
      return { content: [{ type: 'text', text: reply.text }], details: { answers: reply.answers } }
    }
  })
  pi.on('tool_call', async (event) => {
    // 提问本身等待用户作答，不需要再弹一次工具审批。
    if (event.toolName === 'ask_user_question') return undefined
    const tool = pi.getAllTools().find(({ name }) => name === event.toolName)
    const readOnly =
      ['read', 'grep', 'find', 'ls'].includes(event.toolName) ||
      tool?.annotations?.readOnlyHint === true
    const approved =
      channel &&
      (await requestDesktop(channel, {
        type: 'tool',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        input: event.input,
        parentToolCallId: event.parentToolCallId,
        readOnly
      }).then(
        (reply) => reply.approved === true,
        () => false
      ))
    if (!approved) {
      return {
        block: true,
        reason: '用户未批准此次工具调用，请等待用户进一步指示。',
        terminate: true
      }
    }
    return undefined
  })
}
