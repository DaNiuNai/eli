import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type {
  JsonAgentSessionEvent,
  RpcClient,
  RpcClientOptions,
  RpcCommand,
  RpcExtensionUIRequest,
  RpcResponse
} from '@earendil-works/pi-coding-agent'

type RpcData<T extends RpcCommand['type']> =
  Extract<RpcResponse, { command: T; success: true }> extends { data: infer Data } ? Data : void

type RpcEvent = JsonAgentSessionEvent | RpcExtensionUIRequest

interface PendingRequest {
  resolve: (response: RpcResponse) => void
  reject: (error: Error) => void
}

/** 使用 pi 官方 RPC 协议，进程运行于应用自带的 Electron Node 运行时。 */
export class PiRpcClient {
  private child: ChildProcessWithoutNullStreams | null = null
  private listeners = new Set<(event: RpcEvent) => void>()
  private pending = new Map<string, PendingRequest>()
  private requestId = 0
  private stderr = ''
  private exitError: Error | null = null

  constructor(private readonly options: RpcClientOptions & { cliPath: string }) {}

  async start(): Promise<void> {
    if (this.child) throw new Error('Agent 进程已启动')
    this.stderr = ''
    this.exitError = null
    const args = [this.options.cliPath, ...(this.options.args ?? [])]
    if (this.options.provider) args.push('--provider', this.options.provider)
    if (this.options.model) args.push('--model', this.options.model)
    const child = spawn(process.execPath, args, {
      cwd: this.options.cwd,
      env: { ...process.env, ...this.options.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    this.child = child
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-64 * 1024)
    })
    child.on('error', (error) => this.fail(new Error(`无法启动 Agent：${error.message}`)))
    child.stdin.on('error', (error) => this.fail(new Error(`Agent 输入已断开：${error.message}`)))
    child.once('exit', (code, signal) => {
      this.fail(new Error(`Agent 进程已退出 (code=${code}, signal=${signal})。${this.stderr}`))
    })
    // 只以 LF 分帧；readline 会错误拆分 JSON 字符串中的 U+2028/U+2029。
    let buffer = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk
      let newline: number
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        this.handleLine(line)
      }
    })
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', reject)
    })
    // 等待真实的 RPC 响应，确保初始化与扩展加载完成。
    await this.getState()
  }

  async stop(): Promise<void> {
    const child = this.child
    if (!child) return
    this.child = null
    this.fail(new Error('Agent 进程已停止'))
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        child.kill('SIGKILL')
        resolve()
      }, 1000)
      child.once('close', () => {
        clearTimeout(timeout)
        resolve()
      })
      // pi 官方 RPC 支持通过关闭 stdin 正常释放会话并退出。
      child.stdin.end()
    })
  }

  onEvent(listener: (event: RpcEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async prompt(
    ...[message, images, streamingBehavior]: Parameters<RpcClient['prompt']>
  ): ReturnType<RpcClient['prompt']> {
    const result = await this.send({ type: 'prompt', message, images, streamingBehavior })
    return result.disposition
  }

  async abort(): Promise<void> {
    await this.send({ type: 'abort' })
  }

  getState(): ReturnType<RpcClient['getState']> {
    return this.send({ type: 'get_state' })
  }

  setModel(provider: string, modelId: string): ReturnType<RpcClient['setModel']> {
    return this.send({ type: 'set_model', provider, modelId })
  }

  async setThinkingLevel(...[level]: Parameters<RpcClient['setThinkingLevel']>): Promise<void> {
    await this.send({ type: 'set_thinking_level', level })
  }

  async getAvailableModels(): ReturnType<RpcClient['getAvailableModels']> {
    return (await this.send({ type: 'get_available_models' })).models
  }

  async getAvailableThinkingLevels(): ReturnType<RpcClient['getAvailableThinkingLevels']> {
    return (await this.send({ type: 'get_available_thinking_levels' })).levels
  }

  getSessionStats(): ReturnType<RpcClient['getSessionStats']> {
    return this.send({ type: 'get_session_stats' })
  }

  getEntries(): ReturnType<RpcClient['getEntries']> {
    return this.send({ type: 'get_entries' })
  }

  async getMessages(): ReturnType<RpcClient['getMessages']> {
    return (await this.send({ type: 'get_messages' })).messages
  }

  async getCommands(): ReturnType<RpcClient['getCommands']> {
    return (await this.send({ type: 'get_commands' })).commands
  }

  compact(customInstructions?: string): ReturnType<RpcClient['compact']> {
    return this.send({ type: 'compact', customInstructions })
  }

  private handleLine(line: string): void {
    let record: RpcResponse | RpcEvent
    try {
      record = JSON.parse(line)
      if (!record || typeof record.type !== 'string') throw new Error('无效的 RPC 消息')
    } catch {
      this.fail(new Error('Agent 返回了无效的 RPC 消息'))
      return
    }
    if (record.type === 'response') {
      if (record.id) this.pending.get(record.id)?.resolve(record)
    } else {
      for (const listener of [...this.listeners]) listener(record)
    }
  }

  private fail(error: Error): void {
    this.exitError ??= error
    for (const pending of this.pending.values()) pending.reject(this.exitError)
    this.pending.clear()
  }

  private async send<T extends RpcCommand>(command: T): Promise<RpcData<T['type']>> {
    if (this.exitError) throw this.exitError
    const child = this.child
    if (!child || child.stdin.destroyed || !child.stdin.writable) {
      throw new Error('Agent 进程未连接')
    }
    const id = `eli_${++this.requestId}`
    const response = await new Promise<RpcResponse>((resolve, reject) => {
      const finish = (): void => {
        clearTimeout(timeout)
        this.pending.delete(id)
      }
      const timeout = setTimeout(() => {
        finish()
        reject(new Error(`Timeout waiting for response to ${command.type}. ${this.stderr}`))
      }, 30_000)
      this.pending.set(id, {
        resolve: (response) => {
          finish()
          resolve(response)
        },
        reject: (error) => {
          finish()
          reject(error)
        }
      })
      child.stdin.write(`${JSON.stringify({ ...command, id })}\n`, (error) => {
        if (error) this.pending.get(id)?.reject(error)
      })
    })
    if (!response.success) throw new Error(response.error)
    if (response.command !== command.type) throw new Error('Agent RPC 响应与请求不匹配')
    return ('data' in response ? response.data : undefined) as RpcData<T['type']>
  }
}
