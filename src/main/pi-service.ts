import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join, relative, resolve } from 'node:path'
import { stat } from 'node:fs/promises'
import type {
  JsonAgentSessionEvent,
  RpcClient,
  RpcExtensionUIRequest
} from '@earendil-works/pi-coding-agent'
import { piChannels, type PiSnapshot, type PiThinkingLevel } from '../shared/pi'
import {
  updateActiveThinking,
  updateAssistantMessage,
  updateResponseActivity
} from '../shared/pi-messages'
import { PiLibraryService } from './pi-library'
import { readLocalImage } from './image-files'
import {
  copySessionThrough,
  mapMessageEntryIds,
  readHistoryTarget,
  restoreSessionLeaf,
  rewindSessionBefore
} from './pi-history'

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function promptText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 100_000) {
    throw new Error('请输入 1 至 100000 个字符的消息')
  }
  return value.trim()
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
  private activeTools = new Set<string>()
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
    messageEntryIds: [],
    activeThinking: null,
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
      const text = promptText(message)
      await this.exclusive((client) => this.sendPrompt(client, text))
    })
    handle(piChannels.editMessage, async (target, message) => {
      const text = promptText(message)
      await this.exclusive(() => this.editMessage(target, text))
    })
    handle(piChannels.forkMessage, (target) =>
      this.exclusive(async (client) => {
        const { path, entryId } = this.messageTarget(target)
        const copiedPath = await copySessionThrough(path, entryId)
        this.snapshot.libraryVersion++
        const result = await client.switchSession(copiedPath)
        if (result.cancelled) throw new Error('已创建分叉，但扩展取消了切换会话')
        this.snapshot.tools = {}
        this.snapshot.error = null
        await this.refresh(client)
      })
    )
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
    handle(piChannels.readImage, (source) => readLocalImage(source, this.snapshot.cwd))
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
    handle(piChannels.deleteSession, (path) =>
      this.exclusive(async (client) => {
        if (typeof path !== 'string') throw new Error('请选择有效的历史会话')
        const session = await this.library.findSession(path)
        const state = await client.getState()
        const isCurrent = !!state.sessionFile && relative(state.sessionFile, session.path) === ''
        if (isCurrent) {
          const result = await client.newSession()
          if (result.cancelled) throw new Error('扩展取消了新建对话，未删除原会话')
          this.snapshot.tools = {}
          await this.refresh(client)
        }
        try {
          await shell.trashItem(resolve(session.path))
        } catch (cause) {
          if (isCurrent) {
            const restored = await client.switchSession(session.path).catch(() => null)
            if (restored && !restored.cancelled) await this.refresh(client)
          }
          throw cause
        }
        this.snapshot.error = null
        this.snapshot.libraryVersion++
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
    handle(piChannels.chooseDirectory, async (language) => {
      if (language !== undefined && language !== 'zh-CN' && language !== 'en') {
        throw new Error('无效的界面语言')
      }
      if (this.snapshot.running || this.snapshot.pending || this.connecting) {
        throw new Error('请等待当前操作完成')
      }
      this.snapshot.pending = true
      this.publish()
      try {
        const result = await dialog.showOpenDialog(this.window, {
          title: language === 'en' ? 'Choose workspace' : '选择工作目录',
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
    this.snapshot.messageEntryIds = []
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
      throw new Error('本机服务尚未连接，请重新连接')
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

  private messageTarget(value: unknown): { path: string; entryId: string } {
    if (!value || typeof value !== 'object') throw new Error('无效的消息位置')
    const target = value as Record<string, unknown>
    const session = this.snapshot.session
    if (
      typeof target.entryId !== 'string' ||
      !target.entryId ||
      target.entryId.length > 256 ||
      target.sessionId !== session?.sessionId ||
      !session?.sessionFile
    ) {
      throw new Error('会话已变化，请重新选择消息')
    }
    return { path: session.sessionFile, entryId: target.entryId }
  }

  private async sendPrompt(
    client: RpcClient,
    text: string,
    images?: Parameters<RpcClient['prompt']>[1]
  ): Promise<void> {
    if (!this.snapshot.model) throw new Error('请先配置模型，再重新连接')
    this.snapshot.error = null
    this.snapshot.running = true
    this.snapshot.activity = '正在处理'
    this.publish()
    try {
      const disposition = await client.prompt(text, images)
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
  }

  private async editMessage(target: unknown, text: string): Promise<void> {
    const { path, entryId } = this.messageTarget(target)
    const model = this.snapshot.model
    const thinkingLevel = this.snapshot.session?.thinkingLevel
    if (!model) throw new Error('请先配置模型，再重新连接')
    await readHistoryTarget(path, entryId, 'user')
    let previousLeaf: string | null = null
    try {
      // 先停止 RPC 进程，避免两个 SessionManager 同时向同一会话追加记录。
      await this.stopClient()
      const rewound = await rewindSessionBefore(path, entryId)
      previousLeaf = rewound.previousLeaf
      this.sessionFile = path
      this.snapshot.tools = {}
      await this.start()
      const client = this.requireClient()
      await client.setModel(model.provider, model.id)
      if (thinkingLevel && this.snapshot.thinkingLevels.includes(thinkingLevel)) {
        await client.setThinkingLevel(thinkingLevel)
      }
      await this.refresh(client)
      await this.sendPrompt(client, text, rewound.images.length ? rewound.images : undefined)
    } catch (error) {
      // 提交失败时回到原来的活动路径，编辑文本由界面保留以便重试。
      try {
        await this.stopClient()
        if (previousLeaf) await restoreSessionLeaf(path, previousLeaf)
        this.sessionFile = path
        await this.start()
        this.requireClient()
      } catch (restoreError) {
        throw new Error(`${errorText(error)}；恢复会话失败：${errorText(restoreError)}`, {
          cause: restoreError
        })
      }
      throw error
    }
  }

  private async refresh(client: RpcClient): Promise<void> {
    const [state, messages, models, thinkingLevels, stats, history] = await Promise.all([
      client.getState(),
      client.getMessages(),
      client.getAvailableModels(),
      client.getAvailableThinkingLevels(),
      client.getSessionStats(),
      client.getEntries()
    ])
    const { buildSessionProjection } = await import('@earendil-works/pi-coding-agent')
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
    this.snapshot.messageEntryIds = mapMessageEntryIds(
      messages,
      buildSessionProjection(history.entries, history.leafId)
    )
    this.snapshot.activeThinking = null
    this.activeMessage = -1
  }

  private onEvent(event: JsonAgentSessionEvent | RpcExtensionUIRequest): void {
    switch (event.type) {
      case 'agent_start':
        this.snapshot.running = true
        this.snapshot.activeThinking = null
        this.activeTools.clear()
        this.snapshot.activity = '正在处理'
        break
      case 'message_start':
        this.snapshot.activeThinking = null
        this.activeMessage = this.snapshot.messages.length
        this.snapshot.messages.push(event.message)
        this.snapshot.messageEntryIds.push(null)
        break
      case 'message_update': {
        const message = this.snapshot.messages[this.activeMessage]
        if (message) {
          this.snapshot.messages[this.activeMessage] = updateAssistantMessage(message, event)
          this.snapshot.activeThinking = updateActiveThinking(
            this.snapshot.activeThinking,
            event,
            this.activeMessage
          )
          this.snapshot.activity = updateResponseActivity(
            this.snapshot.activity,
            event,
            this.activeTools.size > 0
          )
        }
        break
      }
      case 'message_end':
        this.snapshot.activeThinking = null
        if (this.snapshot.running && this.snapshot.activity !== '正在停止') {
          this.snapshot.activity = this.activeTools.size ? '正在调用工具' : '正在处理'
        }
        if (this.activeMessage >= 0) {
          this.snapshot.messages[this.activeMessage] = event.message
        } else {
          this.snapshot.messages.push(event.message)
          this.snapshot.messageEntryIds.push(null)
        }
        this.activeMessage = -1
        break
      case 'tool_execution_start':
      case 'tool_execution_update':
      case 'tool_execution_end':
        this.snapshot.tools[event.toolCallId] = event
        if (event.type === 'tool_execution_end') this.activeTools.delete(event.toolCallId)
        else this.activeTools.add(event.toolCallId)
        if (this.snapshot.activity !== '正在停止') {
          this.snapshot.activity = this.activeTools.size ? '正在调用工具' : '正在处理'
        }
        break
      case 'agent_settled': {
        this.snapshot.activeThinking = null
        this.activeTools.clear()
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
        this.snapshot.activity = '正在处理'
        this.snapshot.contextUsage = null
        break
      case 'compaction_end':
        this.snapshot.contextUsage = null
        if (event.errorMessage) this.snapshot.error = event.errorMessage
        break
      case 'auto_retry_start':
        this.snapshot.activity = '正在处理'
        break
      case 'auto_retry_end':
        if (event.finalError) this.snapshot.error = event.finalError
        break
      case 'extension_ui_request':
        if (event.method === 'notify') this.snapshot.error = event.message
        else if (['select', 'confirm', 'input', 'editor'].includes(event.method)) {
          // RpcClient 尚无公开的 extension_ui_response 方法，不访问它的私有 stdin。
          this.snapshot.error = '此扩展需要交互，请在命令行中完成。可停止或重新连接。'
        }
        break
    }
    this.publish()
  }

  private fail(error: unknown): void {
    this.snapshot.connection = 'error'
    this.snapshot.running = false
    this.snapshot.activeThinking = null
    this.activeTools.clear()
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
    this.snapshot.activeThinking = null
    this.activeTools.clear()
    await client?.stop()
  }

  async dispose(): Promise<void> {
    this.disposed = true
    clearTimeout(this.broadcastTimer)
    for (const channel of Object.values(piChannels)) ipcMain.removeHandler(channel)
    await this.stopClient()
  }
}
