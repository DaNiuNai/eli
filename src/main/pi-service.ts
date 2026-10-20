import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'node:path'
import { stat } from 'node:fs/promises'
import type {
  JsonAgentSessionEvent,
  RpcClient,
  RpcExtensionUIRequest
} from '@earendil-works/pi-coding-agent'
import { piChannels, type PiSnapshot, type PiThinkingLevel } from '../shared/pi'
import { updateAssistantMessage } from '../shared/pi-messages'
import { PiLibraryService } from './pi-library'

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class PiService {
  private library = new PiLibraryService()
  private client: RpcClient | null = null
  private unsubscribe?: () => void
  private connecting?: Promise<PiSnapshot>
  private heartbeat?: ReturnType<typeof setInterval>
  private broadcastTimer?: ReturnType<typeof setTimeout>
  private checking = false
  private disposed = false
  private activeMessage = -1
  private sessionFile?: string
  private snapshot: PiSnapshot = {
    revision: 0,
    libraryVersion: 0,
    connection: 'connecting',
    cwd: app.isPackaged ? app.getPath('documents') : process.cwd(),
    session: null,
    thinkingLevels: [],
    contextUsage: null,
    model: null,
    models: [],
    messages: [],
    tools: {},
    running: false,
    pending: false,
    activity: '',
    error: null
  }

  constructor(private readonly window: BrowserWindow) {}

  register(): void {
    const handle = (channel: string, action: (...args: unknown[]) => Promise<unknown>): void => {
      ipcMain.handle(channel, (event, ...args: unknown[]) => {
        if (
          event.sender !== this.window.webContents ||
          event.senderFrame !== this.window.webContents.mainFrame
        ) {
          throw new Error('无效的请求来源')
        }
        return action(...args)
      })
    }

    handle(piChannels.connect, async (restart) => {
      if (restart === true && !this.connecting) {
        if (this.snapshot.running || this.snapshot.pending) throw new Error('请先停止当前操作')
        this.snapshot.connection = 'connecting'
      }
      return this.connect()
    })
    handle(piChannels.prompt, async (message) => {
      if (typeof message !== 'string' || !message.trim() || message.length > 100_000) {
        throw new Error('请输入 1 至 100000 个字符的消息')
      }
      await this.exclusive(async (client) => {
        if (!this.snapshot.model) throw new Error('请先在 pi 中配置模型，再重新连接')
        this.snapshot.error = null
        this.snapshot.running = true
        this.snapshot.activity = '正在等待回复'
        this.publish()
        try {
          const disposition = await client.prompt(message.trim())
          if (disposition === 'handled') {
            this.snapshot.running = false
            this.snapshot.activity = ''
            await this.refresh(client)
          }
        } catch (error) {
          this.snapshot.running = false
          this.snapshot.activity = ''
          throw error
        }
      })
    })
    handle(piChannels.abort, async () => {
      const client = this.requireClient()
      this.snapshot.activity = '正在停止'
      this.publish()
      try {
        // abort 也会取消自动重试与压缩，等待 agent_settled 后才恢复输入。
        await client.abort()
      } catch (error) {
        this.fail(error)
        throw error
      }
    })
    handle(piChannels.getLibrary, () => this.library.load(this.snapshot.libraryVersion))
    handle(piChannels.openSession, (path) =>
      this.exclusive(async (client) => {
        if (typeof path !== 'string') throw new Error('请选择有效的历史会话')
        const session = await this.library.findSession(path)
        if (session.cwd && session.cwd !== this.snapshot.cwd) {
          await this.changeWorkspace(session.cwd, session.path)
          return
        }
        const result = await client.switchSession(session.path)
        if (result.cancelled) throw new Error('扩展取消了切换会话')
        this.snapshot.tools = {}
        this.snapshot.error = null
        await this.refresh(client)
      })
    )
    handle(piChannels.newSession, (cwd) =>
      this.exclusive(async (client) => {
        if (cwd !== undefined && typeof cwd !== 'string') throw new Error('无效的工作目录')
        if (typeof cwd === 'string' && cwd !== this.snapshot.cwd) {
          if (!(await this.library.hasWorkspace(cwd))) throw new Error('请选择已有工作目录')
          await this.changeWorkspace(cwd)
          return
        }
        const result = await client.newSession()
        if (result.cancelled) throw new Error('扩展取消了新建对话')
        this.activeMessage = -1
        this.snapshot.tools = {}
        this.snapshot.error = null
        await this.refresh(client)
      })
    )
    handle(piChannels.setThinkingLevel, (level) =>
      this.exclusive(async (client) => {
        if (
          typeof level !== 'string' ||
          !this.snapshot.thinkingLevels.includes(level as PiThinkingLevel)
        ) {
          throw new Error('当前模型不支持该思考强度')
        }
        await client.setThinkingLevel(level as PiThinkingLevel)
        await this.refresh(client)
      })
    )
    handle(piChannels.setModel, (provider, modelId) =>
      this.exclusive(async (client) => {
        if (
          typeof provider !== 'string' ||
          typeof modelId !== 'string' ||
          !this.snapshot.models.some((model) => model.provider === provider && model.id === modelId)
        ) {
          throw new Error('请选择可用的模型')
        }
        await client.setModel(provider, modelId)
        await this.refresh(client)
      })
    )
    handle(piChannels.chooseDirectory, async () => {
      if (this.snapshot.running || this.snapshot.pending || this.connecting) {
        throw new Error('请等待当前操作完成')
      }
      this.snapshot.pending = true
      this.publish()
      try {
        const result = await dialog.showOpenDialog(this.window, {
          title: '选择 pi 的工作目录',
          defaultPath: this.snapshot.cwd,
          properties: ['openDirectory']
        })
        if (result.canceled || !result.filePaths[0] || result.filePaths[0] === this.snapshot.cwd) {
          return
        }
        await this.changeWorkspace(result.filePaths[0])
      } finally {
        this.snapshot.pending = false
        this.publish()
      }
    })
  }

  private async changeWorkspace(cwd: string, sessionFile?: string): Promise<void> {
    if (!(await stat(cwd)).isDirectory()) throw new Error('工作目录不存在或无法访问')
    await this.stopClient()
    this.snapshot.connection = 'connecting'
    this.sessionFile = sessionFile
    this.snapshot.cwd = cwd
    this.snapshot.messages = []
    this.snapshot.tools = {}
    this.snapshot.session = null
    this.snapshot.thinkingLevels = []
    this.snapshot.contextUsage = null
    await this.connect()
    if (this.snapshot.error) throw new Error(this.snapshot.error)
  }

  connect(): Promise<PiSnapshot> {
    if (this.connecting) return this.connecting
    if (this.snapshot.connection === 'ready') return Promise.resolve(this.snapshot)
    this.connecting = this.start().finally(() => {
      this.connecting = undefined
    })
    return this.connecting
  }

  private async start(): Promise<PiSnapshot> {
    await this.stopClient()
    this.snapshot.connection = 'connecting'
    this.snapshot.error = null
    this.snapshot.running = false
    this.publish()
    try {
      // 官方 RpcClient 负责启动 node、JSONL framing、请求关联与超时。
      // 使用发布包的 bundled CLI，保留本机 pi 的登录、模型和扩展配置。
      const { RpcClient, getPackageDir } = await import('@earendil-works/pi-coding-agent')
      if (this.disposed) return this.snapshot
      const cliPath = join(getPackageDir(), 'dist', 'bundle', 'cli.js').replace(
        'app.asar',
        'app.asar.unpacked'
      )
      const client = new RpcClient({
        cliPath,
        cwd: this.snapshot.cwd,
        args: this.sessionFile ? ['--session', this.sessionFile] : []
      })
      this.client = client
      this.unsubscribe = client.onEvent((event) => {
        if (this.client === client) this.onEvent(event)
      })
      await client.start()
      await this.refresh(client)
      if (this.client !== client || this.disposed) return this.snapshot
      this.snapshot.connection = 'ready'
      this.heartbeat = setInterval(() => {
        if (this.checking || this.snapshot.pending || this.snapshot.connection !== 'ready') return
        this.checking = true
        void Promise.all([client.getState(), client.getSessionStats()])
          .then(([state, stats]) => {
            if (
              this.client !== client ||
              this.snapshot.pending ||
              state.sessionId !== this.snapshot.session?.sessionId
            )
              return
            const next = stats.contextUsage ?? null
            if (JSON.stringify(next) !== JSON.stringify(this.snapshot.contextUsage)) {
              this.snapshot.contextUsage = next
              this.publish()
            }
          })
          .catch((error: unknown) => {
            if (this.client === client) this.fail(error)
          })
          .finally(() => {
            this.checking = false
          })
      }, 5000)
      this.publish()
    } catch (error) {
      this.fail(error)
      await this.stopClient()
    }
    return this.snapshot
  }

  private requireClient(): RpcClient {
    if (!this.client || this.snapshot.connection !== 'ready') {
      throw new Error('pi 尚未连接，请重新连接')
    }
    return this.client
  }

  private async exclusive(action: (client: RpcClient) => Promise<void>): Promise<void> {
    const client = this.requireClient()
    if (this.snapshot.pending || this.snapshot.running) throw new Error('请等待当前操作完成')
    this.snapshot.pending = true
    this.publish()
    try {
      await action(client)
    } finally {
      this.snapshot.pending = false
      this.publish()
    }
  }

  private async refresh(client: RpcClient): Promise<void> {
    const [state, messages, models, thinkingLevels, stats] = await Promise.all([
      client.getState(),
      client.getMessages(),
      client.getAvailableModels(),
      client.getAvailableThinkingLevels(),
      client.getSessionStats()
    ])
    if (this.client !== client || this.disposed) return
    this.sessionFile = state.sessionFile
    this.snapshot.session = {
      sessionId: state.sessionId,
      sessionFile: state.sessionFile,
      sessionName: state.sessionName,
      thinkingLevel: state.thinkingLevel
    }
    this.snapshot.thinkingLevels = thinkingLevels
    this.snapshot.contextUsage = stats.contextUsage ?? null
    this.snapshot.libraryVersion++
    // 不把模型配置中的 headers 等字段传入渲染进程。
    this.snapshot.model = state.model
      ? {
          provider: state.model.provider,
          id: state.model.id,
          contextWindow: state.model.contextWindow,
          reasoning: state.model.reasoning
        }
      : null
    this.snapshot.models = models.map(({ provider, id, contextWindow, reasoning }) => ({
      provider,
      id,
      contextWindow,
      reasoning
    }))
    this.snapshot.messages = messages
    this.activeMessage = -1
  }

  private onEvent(event: JsonAgentSessionEvent | RpcExtensionUIRequest): void {
    switch (event.type) {
      case 'agent_start':
        this.snapshot.running = true
        this.snapshot.activity = '正在回复'
        break
      case 'message_start':
        this.activeMessage = this.snapshot.messages.length
        this.snapshot.messages.push(event.message)
        break
      case 'message_update': {
        const message = this.snapshot.messages[this.activeMessage]
        if (message) {
          this.snapshot.messages[this.activeMessage] = updateAssistantMessage(message, event)
        }
        break
      }
      case 'message_end':
        if (this.activeMessage >= 0) {
          this.snapshot.messages[this.activeMessage] = event.message
        } else {
          this.snapshot.messages.push(event.message)
        }
        this.activeMessage = -1
        break
      case 'tool_execution_start':
      case 'tool_execution_update':
      case 'tool_execution_end':
        this.snapshot.tools[event.toolCallId] = event
        this.snapshot.activity =
          event.type === 'tool_execution_end' ? '正在回复' : `正在执行 ${event.toolName}`
        break
      case 'agent_settled': {
        const client = this.client
        if (!client) break
        // 直到最终消息同步完毕才解除锁，避免下一轮与 get_messages 互相覆盖。
        void this.refresh(client)
          .then(() => {
            if (this.client !== client) return
            this.snapshot.running = false
            this.snapshot.activity = event.aborted ? '已停止' : ''
            this.publish()
          })
          .catch((error: unknown) => {
            if (this.client === client) this.fail(error)
          })
        break
      }
      case 'compaction_start':
        this.snapshot.activity = '正在整理上下文'
        this.snapshot.contextUsage = null
        break
      case 'compaction_end':
        this.snapshot.contextUsage = null
        if (event.errorMessage) this.snapshot.error = event.errorMessage
        break
      case 'auto_retry_start':
        this.snapshot.activity = `正在重试（${event.attempt}/${event.maxAttempts}）`
        break
      case 'auto_retry_end':
        if (event.finalError) this.snapshot.error = event.finalError
        break
      case 'extension_ui_request':
        if (event.method === 'notify') this.snapshot.error = event.message
        else if (['select', 'confirm', 'input', 'editor'].includes(event.method)) {
          // RpcClient 尚无公开的 extension_ui_response 方法，不访问它的私有 stdin。
          this.snapshot.error = '此扩展需要交互，请在 pi 命令行中完成。可停止或重新连接。'
        }
        break
    }
    this.publish()
  }

  private fail(error: unknown): void {
    this.snapshot.connection = 'error'
    this.snapshot.running = false
    this.snapshot.activity = ''
    this.snapshot.error = errorText(error)
    this.publish()
  }

  private publish(): void {
    this.snapshot.revision++
    if (this.broadcastTimer || this.disposed) return
    // 合并高频 token 更新，避免每一个 token 都跨 IPC 复制完整会话。
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = undefined
      if (!this.window.isDestroyed()) {
        this.window.webContents.send(piChannels.snapshot, this.snapshot)
      }
    }, 32)
  }

  private async stopClient(): Promise<void> {
    clearInterval(this.heartbeat)
    this.heartbeat = undefined
    this.unsubscribe?.()
    this.unsubscribe = undefined
    const client = this.client
    this.client = null
    this.activeMessage = -1
    await client?.stop()
  }

  async dispose(): Promise<void> {
    this.disposed = true
    clearTimeout(this.broadcastTimer)
    for (const channel of Object.values(piChannels)) ipcMain.removeHandler(channel)
    await this.stopClient()
  }
}
