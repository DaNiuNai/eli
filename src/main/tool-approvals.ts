import { randomUUID } from 'node:crypto'
import { createServer, type Server, type Socket } from 'node:net'
import {
  automaticallyApproveTool,
  type ToolApprovalMode,
  type ToolApprovalRequest
} from '../shared/tool-approval'

interface PendingApproval {
  request: ToolApprovalRequest
  readOnly: boolean
  socket: Socket
}

/** 每个 RPC 进程使用独立的本机通道；只有主进程能够决定是否放行。 */
export class ToolApprovals {
  private server?: Server
  private sockets = new Set<Socket>()
  private pending = new Map<string, PendingApproval>()
  private token = randomUUID()
  private ready = false
  private cancelled = false

  constructor(
    private readonly mode: () => ToolApprovalMode,
    private readonly changed: (requests: ToolApprovalRequest[]) => void
  ) {}

  async start(): Promise<string> {
    this.ready = false
    this.cancelled = false
    this.token = randomUUID()
    const server = createServer((socket) => this.accept(socket))
    this.server = server
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject)
        resolve()
      })
    })
    server.on('error', () => this.cancel())
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('无法启动工具审批服务')
    return JSON.stringify({ port: address.port, token: this.token })
  }

  assertReady(): void {
    // PI 加载扩展失败时可能继续启动，握手缺失必须阻止发送任务。
    if (!this.ready) throw new Error('工具审批扩展未加载，请重新连接')
  }

  private accept(socket: Socket): void {
    this.sockets.add(socket)
    socket.setEncoding('utf8')
    socket.setTimeout(10_000, () => socket.destroy())
    let body = ''
    let received = false
    socket.on('data', (chunk: string) => {
      if (received) return
      body += chunk
      if (Buffer.byteLength(body, 'utf8') > 10 * 1024 * 1024) {
        socket.destroy()
        return
      }
      if (!body.includes('\n')) return
      received = true
      socket.setTimeout(0)
      try {
        const value = JSON.parse(body.slice(0, body.indexOf('\n')))
        if (!value || value.token !== this.token) throw new Error('无效的审批通道')
        if (value.type === 'ready') {
          this.ready = true
          this.reply(socket, true)
          return
        }
        if (
          value.type !== 'tool' ||
          typeof value.toolCallId !== 'string' ||
          typeof value.toolName !== 'string' ||
          !value.input ||
          typeof value.input !== 'object' ||
          Array.isArray(value.input) ||
          typeof value.readOnly !== 'boolean' ||
          (value.parentToolCallId !== undefined && typeof value.parentToolCallId !== 'string')
        )
          throw new Error('无效的工具审批请求')
        if (this.cancelled || !this.ready) {
          this.reply(socket, false)
          return
        }
        if (automaticallyApproveTool(this.mode(), value.toolName, value.readOnly)) {
          this.reply(socket, true)
          return
        }
        const request: ToolApprovalRequest = {
          id: randomUUID(),
          toolCallId: value.toolCallId,
          toolName: value.toolName,
          input: value.input,
          ...(value.parentToolCallId ? { parentToolCallId: value.parentToolCallId } : {})
        }
        this.pending.set(request.id, { request, readOnly: value.readOnly, socket })
        this.publish()
      } catch {
        this.reply(socket, false)
      }
    })
    socket.on('error', () => socket.destroy())
    socket.on('close', () => {
      this.sockets.delete(socket)
      for (const [id, approval] of this.pending) {
        if (approval.socket === socket) {
          this.pending.delete(id)
          this.publish()
        }
      }
    })
  }

  respond(id: unknown, approved: unknown): void {
    if (typeof id !== 'string' || typeof approved !== 'boolean')
      throw new Error('无效的工具审批答复')
    const approval = this.pending.get(id)
    if (!approval) throw new Error('此工具审批已失效')
    this.pending.delete(id)
    this.reply(approval.socket, approved && !this.cancelled)
    this.publish()
  }

  refreshMode(): void {
    for (const [id, { request, readOnly }] of this.pending) {
      if (automaticallyApproveTool(this.mode(), request.toolName, readOnly)) this.respond(id, true)
    }
  }

  begin(): void {
    this.cancelled = false
  }

  cancel(): void {
    this.cancelled = true
    for (const { socket } of this.pending.values()) this.reply(socket, false)
    this.pending.clear()
    this.publish()
  }

  async stop(): Promise<void> {
    this.cancel()
    this.ready = false
    const server = this.server
    this.server = undefined
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
    if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  private reply(socket: Socket, approved: boolean): void {
    if (!socket.destroyed) socket.end(`${JSON.stringify({ approved })}\n`)
  }

  private publish(): void {
    this.changed([...this.pending.values()].map(({ request }) => request))
  }
}
