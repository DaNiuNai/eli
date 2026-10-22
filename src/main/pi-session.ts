import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { stat } from 'node:fs/promises'
import type {
  JsonAgentSessionEvent,
  ModelInfo,
  ModelRuntime,
  RpcClient,
  RpcExtensionUIRequest,
  SettingsManager
} from '@earendil-works/pi-coding-agent'
import type {
  PiLiveSession,
  PiSessionSnapshot,
  PiSkillCommand,
  PiThinkingLevel
} from '../shared/pi'
import {
  updateActiveThinking,
  updateAssistantMessage,
  updateResponsePhase,
  updateToolCallDrafts
} from '../shared/pi-messages'
import {
  mapMessageEntryIds,
  readHistoryTarget,
  restoreSessionLeaf,
  rewindSessionBefore
} from './pi-history'
import { compactContext, compactionSkipReason } from './pi-compaction'
import { ToolApprovals } from './tool-approvals'
import { UserQuestions } from './user-questions'
import type { ToolApprovalMode } from '../shared/tool-approval'
import approvalExtensionPath from '../../resources/tool-approval.ts?asset&asarUnpack'

const idleTimeout = 5 * 60 * 1000

function modelInfo({ provider, id, contextWindow, reasoning }: ModelInfo): ModelInfo {
  // 模型的 headers、凭据等配置不跨 IPC 传入界面。
  return { provider, id, contextWindow, reasoning }
}

/** 一个会话独占一个官方 RpcClient；加载历史与配置不启动子进程。 */
export class PiSession {
  readonly key = randomUUID()
  private created = Date.now()
  private modified = this.created
  private title = ''
  private submitted = false
  private persisted = false
  private client: RpcClient | null = null
  private unsubscribe?: () => void
  private connecting?: Promise<RpcClient>
  private compaction?: AbortController
  private stopping?: Promise<void>
  private disposing?: Promise<void>
  private heartbeat?: ReturnType<typeof setInterval>
  private idleTimer?: ReturnType<typeof setTimeout>
  private checking = false
  private disposed = false
  private activeMessage = -1
  private activeTools = new Set<string>()
  private settings!: SettingsManager
  private settingsVersion = 0
  private appliedSettingsVersion = 0
  private approvals: ToolApprovals
  private questions: UserQuestions
  readonly snapshot: PiSessionSnapshot

  constructor(
    cwd: string,
    private readonly models: () => Promise<ModelRuntime>,
    private readonly changed: (libraryChanged?: boolean) => void,
    approvalMode: () => ToolApprovalMode,
    sessionFile?: string
  ) {
    this.persisted = !!sessionFile
    this.snapshot = {
      connection: 'connecting',
      cwd,
      session: { sessionId: this.key, sessionFile, thinkingLevel: 'medium' },
      thinkingLevels: [],
      contextUsage: null,
      model: null,
      models: [],
      messages: [],
      messageEntryIds: [],
      activeThinking: null,
      response: { id: 0, messageIndex: 0, phase: 'idle', toolCallDrafts: {} },
      tools: {},
      toolApprovals: [],
      userQuestions: [],
      running: false,
      pending: false,
      activity: '',
      error: null,
      hideThinkingBlock: false
    }
    this.questions = new UserQuestions((requests) => {
      this.snapshot.userQuestions = requests
      this.changed()
    })
    this.approvals = new ToolApprovals(
      approvalMode,
      (requests) => {
        this.snapshot.toolApprovals = requests
        this.changed()
      },
      this.questions
    )
  }

  async load(): Promise<void> {
    this.snapshot.running = false
    this.finishResponse()
    const { SessionManager, SettingsManager } = await import('@earendil-works/pi-coding-agent')
    const path = this.persisted ? this.snapshot.session?.sessionFile : undefined
    let savedModel: { provider: string; modelId: string } | null = null
    let savedThinking: string | undefined
    if (path) {
      const info = await stat(path)
      const manager = SessionManager.open(path)
      const projection = manager.buildSessionProjection()
      this.snapshot.cwd = manager.getCwd() || this.snapshot.cwd
      this.snapshot.session = {
        sessionId: manager.getSessionId(),
        sessionFile: path,
        sessionName: manager.getSessionName(),
        thinkingLevel: 'medium'
      }
      this.snapshot.messages = projection.messages
      this.snapshot.messageEntryIds = mapMessageEntryIds(projection.messages, projection)
      savedModel = projection.model
      savedThinking = projection.thinkingLevel
      this.title = manager.getSessionName() || this.firstUserText()
      this.submitted = true
      this.created = new Date(manager.getHeader()?.timestamp ?? info.birthtimeMs).getTime()
      this.modified = info.mtimeMs
    }
    this.settings = SettingsManager.create(this.snapshot.cwd)
    this.snapshot.hideThinkingBlock = this.settings.getHideThinkingBlock()
    await this.loadModels()
    const provider = savedModel?.provider ?? this.settings.getDefaultProvider()
    const id = savedModel?.modelId ?? this.settings.getDefaultModel()
    const selected =
      this.snapshot.models.find((model) => model.provider === provider && model.id === id) ??
      this.snapshot.models[0]
    await this.configureModel(selected ?? null, savedThinking)
    this.snapshot.connection = 'ready'
    this.snapshot.error = null
  }

  get sessionDirectory(): string | undefined {
    const directory = this.settings.getSessionDir()
    if (!directory) return undefined
    return resolve(this.snapshot.cwd, directory.replace(/^~(?=$|[\\/])/, homedir()))
  }

  invalidateSettings(): void {
    this.settingsVersion++
    // 展示设置立即刷新，正在运行的 RPC 在下一次操作启动时再更新。
    void this.settings
      .reload()
      .then(() => {
        if (this.disposed) return
        this.snapshot.hideThinkingBlock = this.settings.getHideThinkingBlock()
        this.changed()
      })
      .catch((error: unknown) => {
        this.snapshot.error = error instanceof Error ? error.message : String(error)
        this.changed()
      })
  }

  async refreshAuth(): Promise<void> {
    await this.loadModels()
    if (this.disposed) return
    if (!this.snapshot.model) {
      await this.configureModel(this.snapshot.models[0] ?? null)
    }
    // 新请求重启 RPC，使它读取 pi 刚保存的认证；正在生成的回复继续运行。
    this.settingsVersion++
    this.changed()
  }

  private async loadModels(): Promise<void> {
    const runtime = await this.models()
    const patterns = this.settings.getEnabledModels()
    if (patterns?.length) {
      const { resolveModelScopeWithDiagnostics } = await import('@earendil-works/pi-coding-agent')
      const { scopedModels } = await resolveModelScopeWithDiagnostics(patterns, runtime)
      this.snapshot.models = scopedModels.map(({ model }) => modelInfo(model))
    } else this.snapshot.models = (await runtime.getAvailable()).map(modelInfo)
    const current = this.snapshot.model
    if (
      current &&
      !this.snapshot.models.some(
        (model) => model.provider === current.provider && model.id === current.id
      )
    )
      this.snapshot.models.unshift(current)
  }

  private firstUserText(): string {
    const message = this.snapshot.messages.find((message) => message.role === 'user')
    if (!message || message.role !== 'user') return ''
    return typeof message.content === 'string'
      ? message.content
      : message.content
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('\n')
  }

  get summary(): PiLiveSession | null {
    if (!this.submitted) return null
    return {
      key: this.key,
      path: this.snapshot.session?.sessionFile ?? this.key,
      id: this.snapshot.session?.sessionId ?? this.key,
      cwd: this.snapshot.cwd,
      title: (this.snapshot.session?.sessionName || this.title || '未命名对话')
        .replace(/\s+/g, ' ')
        .slice(0, 160),
      created: this.created,
      modified: this.modified,
      messageCount: this.snapshot.messages.length,
      running: this.snapshot.running,
      pending: this.snapshot.pending,
      approvalCount: this.snapshot.toolApprovals.length,
      questionCount: this.snapshot.userQuestions.length
    }
  }

  get busy(): boolean {
    return this.snapshot.running || this.snapshot.pending
  }

  respondToToolApproval(id: unknown, approved: unknown): void {
    this.approvals.respond(id, approved)
  }

  respondToUserQuestion(id: unknown, answers: unknown): void {
    this.questions.respond(id, answers)
  }

  refreshApprovalMode(): void {
    this.approvals.refreshMode()
  }

  get persistedFile(): string | undefined {
    return this.persisted ? this.snapshot.session?.sessionFile : undefined
  }

  private async configureModel(model: ModelInfo | null, thinking?: string): Promise<void> {
    const { clampThinkingLevel, getSupportedThinkingLevels } = await import('@earendil-works/pi-ai')
    this.snapshot.model = model
    const nativeModel = model ? (await this.models()).getModel(model.provider, model.id) : undefined
    this.snapshot.thinkingLevels = nativeModel ? getSupportedThinkingLevels(nativeModel) : ['off']
    const requested =
      thinking ??
      (model && this.settings.getModelThinkingLevel(model.provider, model.id)) ??
      this.settings.getDefaultThinkingLevel() ??
      'medium'
    const level = nativeModel
      ? clampThinkingLevel(nativeModel, requested as PiThinkingLevel)
      : 'off'
    if (this.snapshot.session) this.snapshot.session.thinkingLevel = level
  }

  async exclusive(action: () => Promise<void>): Promise<void> {
    if (this.disposed) throw new Error('会话已关闭')
    if (this.busy) throw new Error('请等待当前操作完成')
    clearTimeout(this.idleTimer)
    this.snapshot.pending = true
    this.changed()
    try {
      await action()
    } finally {
      this.snapshot.pending = false
      this.scheduleIdle()
      this.changed()
    }
  }

  async prompt(text: string): Promise<void> {
    await this.exclusive(async () => {
      this.beginResponse()
      if (!this.submitted) {
        this.submitted = true
        this.title = text
        // 先发布占位会话，pi 初始化期间也能切走或创建另一个会话。
        this.changed(true)
      }
      const client = await this.ensureClient().catch((error: unknown) => {
        this.fail(error)
        throw error
      })
      await this.sendPrompt(client, text)
    })
  }

  async getSkills(): Promise<PiSkillCommand[]> {
    const read = async (client: RpcClient): Promise<PiSkillCommand[]> =>
      (await client.getCommands())
        .filter((command) => command.source === 'skill')
        .map(({ name, description }) => ({ name, description }))

    // 生成期间只查询已有进程，不能为了刷新技能重启正在运行的任务。
    if (this.busy) {
      const client = this.connecting ? await this.connecting : this.client
      if (!client || this.disposed) throw new Error('请等待当前操作完成')
      return read(client)
    }
    let skills: PiSkillCommand[] = []
    await this.exclusive(async () => {
      skills = await read(await this.ensureClient())
    })
    return skills
  }

  async compact(instructions?: string): Promise<void> {
    await this.exclusive(async () => {
      if (!this.snapshot.model) throw new Error('请先配置模型，再重新连接')
      const client = await this.ensureClient()
      const controller = new AbortController()
      this.compaction = controller
      this.snapshot.running = true
      this.snapshot.activity = '正在整理上下文'
      this.snapshot.error = null
      this.changed()
      let activity = ''
      try {
        const outcome = await compactContext(client, instructions, controller.signal)
        if (this.client === client && !this.disposed) {
          await this.refresh(client)
          if (outcome === 'compacted') this.modified = Date.now()
          activity = {
            compacted: '上下文压缩完成',
            cancelled: '已停止',
            'too-small': '当前没有可压缩的历史内容，可继续对话',
            'already-compacted': '当前上下文已压缩，暂无新的内容需要整理'
          }[outcome]
        }
      } finally {
        if (this.compaction === controller) this.compaction = undefined
        if (this.client === client && !this.disposed) {
          this.snapshot.running = false
          this.finishResponse()
          this.snapshot.activity = activity
          this.changed()
        }
      }
    })
  }

  private ensureClient(): Promise<RpcClient> {
    if (this.connecting) return this.connecting
    this.connecting = this.startClient().finally(() => {
      this.connecting = undefined
    })
    return this.connecting
  }

  private async startClient(): Promise<RpcClient> {
    await this.stopping
    if (this.disposed) throw new Error('会话已关闭')
    if (this.settingsVersion !== this.appliedSettingsVersion) {
      const version = this.settingsVersion
      await this.stopClient()
      await this.settings.reload()
      await this.loadModels()
      this.appliedSettingsVersion = version
    }
    if (this.client) return this.client
    const { RpcClient, getPackageDir } = await import('@earendil-works/pi-coding-agent')
    if (this.disposed) throw new Error('会话已关闭')
    const desiredModel = this.snapshot.model
    const thinkingLevel = this.snapshot.session?.thinkingLevel
    this.snapshot.connection = 'connecting'
    this.snapshot.error = null
    this.changed()
    const approvalChannel = await this.approvals.start()
    const client = new RpcClient({
      cliPath: join(getPackageDir(), 'dist', 'bundle', 'cli.js').replace(
        'app.asar',
        'app.asar.unpacked'
      ),
      cwd: this.snapshot.cwd,
      provider: desiredModel?.provider,
      model: desiredModel?.id,
      // pi 自带的精确会话 ID 避免首轮失败重试时产生第二个会话。
      args: [
        '--extension',
        approvalExtensionPath,
        '--eli-approval-channel',
        approvalChannel,
        ...(this.persistedFile
          ? ['--session', this.persistedFile]
          : [
              '--session-id',
              this.key,
              ...(this.sessionDirectory ? ['--session-dir', this.sessionDirectory] : [])
            ])
      ]
    })
    this.client = client
    this.unsubscribe = client.onEvent((event) => {
      if (this.client === client && !this.disposed) this.onEvent(event)
    })
    try {
      await client.start()
      if (this.disposed) throw new Error('会话已关闭')
      if (thinkingLevel) await client.setThinkingLevel(thinkingLevel)
      await this.refresh(client)
      this.approvals.assertReady()
      this.snapshot.connection = 'ready'
      this.heartbeat = setInterval(() => {
        if (this.checking || this.snapshot.pending) return
        this.checking = true
        void Promise.all([client.getState(), client.getSessionStats()])
          .then(([, stats]) => {
            if (this.client !== client || this.disposed || this.snapshot.pending) return
            const next = stats.contextUsage ?? null
            if (JSON.stringify(next) !== JSON.stringify(this.snapshot.contextUsage)) {
              this.snapshot.contextUsage = next
              this.changed()
            }
          })
          .catch((error: unknown) => {
            if (this.client === client) this.fail(error)
          })
          .finally(() => {
            this.checking = false
          })
      }, 5000)
      return client
    } catch (error) {
      this.fail(error)
      await this.stopClient()
      throw error
    }
  }

  private async sendPrompt(
    client: RpcClient,
    text: string,
    images?: Parameters<RpcClient['prompt']>[1]
  ): Promise<void> {
    const responseId = this.snapshot.response.id
    this.snapshot.running = true
    this.changed()
    try {
      const disposition = await client.prompt(text, images)
      // 接收确认可能晚于首个 token，甚至晚于快速完成，不能覆盖已经推进的阶段。
      if (this.snapshot.response.id !== responseId || !this.snapshot.running) return
      if (disposition === 'handled') {
        await this.refresh(client)
        this.snapshot.running = false
        this.finishResponse()
        this.snapshot.activity = ''
      } else if (this.snapshot.response.phase === 'sending') {
        this.snapshot.response.phase = 'waiting'
      }
      this.changed()
    } catch (error) {
      this.fail(error)
      throw error
    }
  }

  private beginResponse(): void {
    if (!this.snapshot.model) throw new Error('请先配置模型，再重新连接')
    this.snapshot.response = {
      id: this.snapshot.response.id + 1,
      messageIndex: this.snapshot.messages.length,
      phase: 'sending',
      toolCallDrafts: {}
    }
    this.snapshot.activeThinking = null
    this.approvals.begin()
    this.activeTools.clear()
    this.snapshot.activity = ''
    this.snapshot.error = null
    this.modified = Date.now()
    this.changed()
  }

  private finishResponse(): void {
    this.approvals.cancel()
    this.snapshot.response.phase = 'idle'
    this.snapshot.response.toolCallDrafts = {}
    this.snapshot.activeThinking = null
    this.activeTools.clear()
  }

  async abort(): Promise<void> {
    const client = this.client
    if (!client || !this.snapshot.running) return
    this.snapshot.activity = '正在停止'
    this.approvals.cancel()
    this.changed()
    try {
      // abort 会同时取消重试和压缩，最终由 agent_settled 解除运行状态。
      await client.abort()
    } catch (error) {
      this.fail(error)
      throw error
    }
  }

  async setModel(provider: string, id: string): Promise<void> {
    await this.exclusive(async () => {
      const model = this.snapshot.models.find(
        (model) => model.provider === provider && model.id === id
      )
      if (!model) throw new Error('请选择可用的模型')
      if (this.client) {
        await this.client.setModel(provider, id)
        await this.refresh(this.client)
      } else {
        await this.configureModel(model)
        this.settings.setDefaultModelAndProvider(provider, id)
        await this.settings.flush()
      }
    })
  }

  async setThinkingLevel(level: PiThinkingLevel): Promise<void> {
    await this.exclusive(async () => {
      if (!this.snapshot.thinkingLevels.includes(level)) throw new Error('当前模型不支持该思考强度')
      if (this.client) {
        await this.client.setThinkingLevel(level)
        await this.refresh(this.client)
      } else {
        if (this.snapshot.session) this.snapshot.session.thinkingLevel = level
        const model = this.snapshot.model
        if (model) this.settings.setModelThinkingLevel(model.provider, model.id, level)
        this.settings.setDefaultThinkingLevel(level)
        await this.settings.flush()
      }
    })
  }

  messageTarget(value: unknown): { path: string; entryId: string } {
    if (!value || typeof value !== 'object') throw new Error('无效的消息位置')
    const target = value as Record<string, unknown>
    const session = this.snapshot.session
    if (
      typeof target.entryId !== 'string' ||
      !target.entryId ||
      target.entryId.length > 256 ||
      target.sessionId !== session?.sessionId ||
      !session?.sessionFile
    )
      throw new Error('会话已变化，请重新选择消息')
    return { path: session.sessionFile, entryId: target.entryId }
  }

  async editMessage(target: unknown, text: string): Promise<void> {
    await this.exclusive(async () => {
      const { path, entryId } = this.messageTarget(target)
      const model = this.snapshot.model
      const thinkingLevel = this.snapshot.session?.thinkingLevel
      if (!model) throw new Error('请先配置模型，再重新连接')
      await readHistoryTarget(path, entryId, 'user')
      let previousLeaf: string | null = null
      try {
        // 同一文件始终只允许一个写入者。
        await this.stopClient()
        const rewound = await rewindSessionBefore(path, entryId)
        previousLeaf = rewound.previousLeaf
        this.snapshot.tools = {}
        const client = await this.ensureClient()
        await client.setModel(model.provider, model.id)
        if (thinkingLevel && this.snapshot.thinkingLevels.includes(thinkingLevel)) {
          await client.setThinkingLevel(thinkingLevel)
        }
        await this.refresh(client)
        this.beginResponse()
        await this.sendPrompt(client, text, rewound.images.length ? rewound.images : undefined)
      } catch (error) {
        await this.stopClient()
        if (previousLeaf) await restoreSessionLeaf(path, previousLeaf)
        await this.load()
        throw error
      }
    })
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
    this.snapshot.session = {
      sessionId: state.sessionId,
      sessionFile: state.sessionFile,
      sessionName: state.sessionName,
      thinkingLevel: state.thinkingLevel
    }
    this.snapshot.thinkingLevels = thinkingLevels
    this.snapshot.contextUsage = stats.contextUsage ?? null
    this.snapshot.model = state.model ? modelInfo(state.model) : null
    if (this.settings.getEnabledModels()?.length) await this.loadModels()
    else this.snapshot.models = models.map(modelInfo)
    this.snapshot.messages = messages
    if (messages.some((message) => message.role === 'user' || message.role === 'assistant')) {
      this.persisted = true
    }
    this.snapshot.messageEntryIds = mapMessageEntryIds(
      messages,
      buildSessionProjection(history.entries, history.leafId)
    )
    this.snapshot.activeThinking = null
    this.activeMessage = -1
    this.changed(true)
  }

  private onEvent(event: JsonAgentSessionEvent | RpcExtensionUIRequest): void {
    switch (event.type) {
      case 'agent_start':
        clearTimeout(this.idleTimer)
        this.snapshot.running = true
        this.snapshot.activeThinking = null
        this.activeTools.clear()
        if (this.snapshot.response.phase === 'idle') this.snapshot.response.phase = 'waiting'
        break
      case 'turn_start':
        // 工具结果触发下一轮模型请求；首轮仍等待 prompt 的接收确认。
        if (
          this.snapshot.response.phase !== 'idle' &&
          this.snapshot.response.phase !== 'sending' &&
          this.snapshot.activity !== '正在停止'
        ) {
          this.snapshot.response.phase = 'waiting'
        }
        break
      case 'message_start':
        this.snapshot.activeThinking = null
        this.activeMessage = this.snapshot.messages.length
        this.snapshot.messages.push(event.message)
        this.snapshot.messageEntryIds.push(null)
        if (
          event.message.role === 'assistant' &&
          this.snapshot.response.phase !== 'idle' &&
          this.snapshot.activity !== '正在停止'
        ) {
          this.snapshot.response.phase = 'waiting'
        }
        if (event.message.role === 'user') this.changed(true)
        break
      case 'message_update': {
        const message = this.snapshot.messages[this.activeMessage]
        if (message) {
          this.snapshot.response.toolCallDrafts = updateToolCallDrafts(
            this.snapshot.response.toolCallDrafts,
            message,
            event
          )
          this.snapshot.messages[this.activeMessage] = updateAssistantMessage(message, event)
          this.snapshot.activeThinking = updateActiveThinking(
            this.snapshot.activeThinking,
            event,
            this.activeMessage
          )
          if (this.snapshot.response.phase !== 'idle' && this.snapshot.activity !== '正在停止') {
            this.snapshot.response.phase = updateResponsePhase(this.snapshot.response.phase, event)
          }
        }
        break
      }
      case 'message_end':
        if (event.message.role === 'user' || event.message.role === 'assistant')
          this.persisted = true
        this.snapshot.activeThinking = null
        if (event.message.role === 'assistant') this.snapshot.response.toolCallDrafts = {}
        if (this.activeMessage >= 0) this.snapshot.messages[this.activeMessage] = event.message
        else {
          this.snapshot.messages.push(event.message)
          this.snapshot.messageEntryIds.push(null)
        }
        this.activeMessage = -1
        break
      case 'tool_execution_start':
      case 'tool_execution_update':
      case 'tool_execution_end': {
        const previous = this.snapshot.tools[event.toolCallId]
        if (previous?.type === 'tool_execution_end' && event.type !== 'tool_execution_end') break
        this.snapshot.tools[event.toolCallId] = event
        if (event.type === 'tool_execution_end') this.activeTools.delete(event.toolCallId)
        else this.activeTools.add(event.toolCallId)
        if (this.snapshot.response.phase !== 'idle' && this.snapshot.activity !== '正在停止') {
          // 并行工具的进度不能覆盖正在输出的新消息。
          const message = this.snapshot.messages[this.activeMessage]
          if (message?.role !== 'assistant') {
            this.snapshot.response.phase = this.activeTools.size ? 'tool-running' : 'waiting'
          }
        }
        break
      }
      case 'agent_settled': {
        // 手动压缩会先中止 pi 的当前运行，由 compact() 统一刷新和解除状态。
        if (this.compaction) break
        // settled 才代表本轮不再输出或调用工具；刷新历史期间也不再显示忙碌动画。
        this.finishResponse()
        const client = this.client
        if (!client) break
        // 最终消息同步完再开始空闲倒计时，不能在 agent_end 时提前回收自动重试。
        void this.refresh(client)
          .then(() => {
            if (this.client !== client || this.disposed) return
            this.snapshot.running = false
            this.snapshot.activity = event.aborted ? '已停止' : ''
            this.scheduleIdle()
            this.changed()
          })
          .catch((error: unknown) => {
            if (this.client === client) this.fail(error)
          })
        break
      }
      case 'compaction_start':
        if (this.snapshot.activity !== '正在停止') this.snapshot.activity = '正在整理上下文'
        this.snapshot.activeThinking = null
        if (!this.compaction && this.snapshot.activity !== '正在停止') {
          this.snapshot.response.phase = 'waiting'
        }
        this.snapshot.contextUsage = null
        break
      case 'compaction_end':
        if (!this.compaction && this.snapshot.activity !== '正在停止') this.snapshot.activity = ''
        this.snapshot.contextUsage = null
        if (
          event.errorMessage &&
          !(
            this.compaction &&
            event.reason === 'manual' &&
            compactionSkipReason(event.errorMessage)
          )
        )
          this.snapshot.error = event.errorMessage
        break
      case 'auto_retry_start':
        if (this.snapshot.response.phase !== 'idle' && this.snapshot.activity !== '正在停止') {
          this.snapshot.response.phase = 'waiting'
          this.snapshot.activeThinking = null
          this.snapshot.response.toolCallDrafts = {}
        }
        break
      case 'auto_retry_end':
        if (event.finalError) this.snapshot.error = event.finalError
        break
      case 'extension_ui_request':
        if (event.method === 'notify') this.snapshot.error = event.message
        else if (['select', 'confirm', 'input', 'editor'].includes(event.method)) {
          this.snapshot.error = '此扩展需要交互，请在命令行中完成。可停止或重新连接。'
        }
        break
    }
    this.changed()
  }

  private fail(error: unknown): void {
    this.snapshot.connection = 'error'
    this.snapshot.running = false
    this.finishResponse()
    this.snapshot.activity = ''
    this.snapshot.error = error instanceof Error ? error.message : String(error)
    void this.stopClient().catch(() => {})
    this.changed()
  }

  private scheduleIdle(): void {
    clearTimeout(this.idleTimer)
    if (!this.client || this.busy || this.disposed) return
    this.idleTimer = setTimeout(() => {
      if (this.busy || this.disposed) return
      void this.stopClient().catch((error: unknown) => this.fail(error))
    }, idleTimeout)
  }

  async stopClient(): Promise<void> {
    if (this.stopping) return this.stopping
    this.compaction?.abort()
    clearTimeout(this.idleTimer)
    clearInterval(this.heartbeat)
    this.unsubscribe?.()
    this.unsubscribe = undefined
    const client = this.client
    this.client = null
    this.activeMessage = -1
    this.snapshot.activeThinking = null
    this.snapshot.response.toolCallDrafts = {}
    this.activeTools.clear()
    this.stopping = (async () => {
      await this.approvals.stop()
      await client?.stop()
    })().finally(() => {
      this.stopping = undefined
    })
    return this.stopping
  }

  dispose(): Promise<void> {
    if (this.disposing) return this.disposing
    this.disposed = true
    clearTimeout(this.idleTimer)
    clearInterval(this.heartbeat)
    this.disposing = (async () => {
      await this.connecting?.catch(() => {})
      await this.stopClient()
      await this.settings?.flush()
    })()
    return this.disposing
  }
}
