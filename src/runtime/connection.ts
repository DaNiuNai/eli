import {
  mainAgentId,
  runtimeProtocolVersion,
  type RuntimeMethod,
  type RuntimeMethods,
  type RuntimeMessage
} from '../shared/runtime'

export interface RuntimeTransport {
  send(message: unknown): void
  kill(): void
  onMessage(listener: (value: unknown) => void): void
  onExit(listener: (error: Error) => void): void
}

/** 带版本、请求关联和失败传播的应用消息通道，不实现或转发 pi RPC。 */
export class RuntimeConnection {
  private requests = new Map<
    string,
    {
      resolve: (result: unknown) => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  private nextId = 0
  private error?: Error
  private stopping = false
  private stopPromise?: Promise<void>
  private rejectReady?: (error: Error) => void
  readonly ready: Promise<void>

  constructor(
    private readonly transport: RuntimeTransport,
    private readonly event: (message: RuntimeMessage) => void,
    private readonly failed: (error: Error) => void,
    private readonly timeoutMs = 60_000
  ) {
    this.ready = new Promise<void>((resolve, reject) => {
      this.rejectReady = reject
      const timer = setTimeout(() => {
        const error = new Error('Runtime 启动超时')
        reject(error)
        this.fail(error)
      }, timeoutMs)
      transport.onMessage((value) => {
        if (
          !value ||
          typeof value !== 'object' ||
          !('kind' in value) ||
          !['ready', 'response', 'session', 'auth', 'authenticated', 'fatal'].includes(
            String(value.kind)
          )
        ) {
          clearTimeout(timer)
          this.fail(new Error('Runtime 返回了无效消息'))
          return
        }
        const message = value as RuntimeMessage
        if (message.version !== runtimeProtocolVersion) {
          clearTimeout(timer)
          const error = new Error('Runtime 协议版本不匹配')
          reject(error)
          this.fail(error)
          return
        }
        if (message.kind === 'ready') {
          clearTimeout(timer)
          this.rejectReady = undefined
          resolve()
          return
        }
        if (message.kind === 'fatal') {
          clearTimeout(timer)
          const error = new Error(message.error)
          reject(error)
          this.fail(error)
          return
        }
        if (message.kind === 'response') {
          if (typeof message.id !== 'string' || typeof message.ok !== 'boolean') {
            this.fail(new Error('Runtime 返回了无效响应'))
            return
          }
          const pending = this.requests.get(message.id)
          if (!pending) return
          this.requests.delete(message.id)
          clearTimeout(pending.timer)
          if (message.ok) pending.resolve(message.result)
          else pending.reject(new Error(message.error))
        } else this.event(message)
      })
      transport.onExit((error) => {
        clearTimeout(timer)
        reject(error)
        this.fail(error)
      })
    })
    // 启动后紧接着关闭时 ready 也可能拒绝；call() 仍会向调用者传递错误。
    void this.ready.catch(() => {})
  }

  async call<K extends RuntimeMethod>(
    method: K,
    ...args: RuntimeMethods[K]['args']
  ): Promise<RuntimeMethods[K]['result']> {
    await this.ready
    if (this.error) throw this.error
    if (this.stopping && method !== 'shutdown') throw new Error('Runtime 正在关闭')
    const id = String(++this.nextId)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.fail(new Error(`Runtime 操作超时：${method}`)),
        method === 'shutdown' ? 5000 : this.timeoutMs
      )
      this.requests.set(id, {
        resolve: (result) => resolve(result as RuntimeMethods[K]['result']),
        reject,
        timer
      })
      try {
        this.transport.send({
          version: runtimeProtocolVersion,
          kind: 'request',
          id,
          agentId: mainAgentId,
          method,
          args
        })
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private fail(error: Error): void {
    if (this.error) return
    this.error = error
    this.rejectReady?.(error)
    this.rejectReady = undefined
    for (const request of this.requests.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    this.requests.clear()
    this.transport.kill()
    if (!this.stopping) this.failed(error)
  }

  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise
    this.stopping = true
    const timeout = setTimeout(() => this.fail(new Error('Runtime 关闭超时')), 5000)
    this.stopPromise = this.call('shutdown')
      .catch(() => {})
      .finally(() => {
        clearTimeout(timeout)
        this.fail(new Error('Runtime 已停止'))
      })
    return this.stopPromise
  }
}
