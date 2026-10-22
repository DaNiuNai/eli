import { createConnection } from 'node:net'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

interface ApprovalChannel {
  port: number
  token: string
}

function requestApproval(
  channel: ApprovalChannel,
  message: Record<string, unknown>
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port: channel.port })
    let body = ''
    let settled = false
    const finish = (approved: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(connecting)
      socket.destroy()
      resolve(approved)
    }
    const connecting = setTimeout(() => finish(false), 10_000)
    socket.setEncoding('utf8')
    socket.on('connect', () => {
      clearTimeout(connecting)
      socket.write(`${JSON.stringify({ ...message, token: channel.token })}\n`)
    })
    socket.on('data', (chunk) => {
      body += chunk
      if (!body.includes('\n')) return
      try {
        finish(JSON.parse(body.slice(0, body.indexOf('\n'))).approved === true)
      } catch {
        finish(false)
      }
    })
    socket.on('error', () => finish(false))
    socket.on('close', () => finish(false))
  })
}

/** 使用 PI 的执行前钩子，直接调用、MCP 及 codemode 嵌套调用均经过审批。 */
export default function toolApproval(pi: ExtensionAPI): void {
  pi.registerFlag('eli-approval-channel', { type: 'string' })
  let channel: ApprovalChannel | undefined
  pi.on('session_start', async () => {
    const next: ApprovalChannel = JSON.parse(String(pi.getFlag('eli-approval-channel')))
    channel = next
    if (!(await requestApproval(next, { type: 'ready' }))) {
      channel = undefined
      throw new Error('无法连接 eli 工具审批服务')
    }
  })
  pi.on('tool_call', async (event) => {
    const tool = pi.getAllTools().find(({ name }) => name === event.toolName)
    const readOnly =
      ['read', 'grep', 'find', 'ls'].includes(event.toolName) ||
      tool?.annotations?.readOnlyHint === true
    const approved =
      channel &&
      (await requestApproval(channel, {
        type: 'tool',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        input: event.input,
        parentToolCallId: event.parentToolCallId,
        readOnly
      }))
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
