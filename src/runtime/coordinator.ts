import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { Context, Plugin } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, AssistantStreamFrame } from '@deepseek-ai/dsh-agent'
import { parseCommand } from '@deepseek-ai/dsh-commands'
import {
  Session,
  SessionId,
  SessionSeq,
  SessionLogOffset,
  buildForkSeed,
  appendPluginRecord,
  type SessionEvent
} from '@deepseek-ai/dsh-session'
import {
  BlockAssembler,
  createUserMessage,
  createSystemMessage,
  ReasoningEffortId,
  type ContentBlock
} from '@deepseek-ai/dsh-llm'
import { getSupportedThinkingLevels, clampThinkingLevel } from '@earendil-works/pi-ai'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { EliConfigStore } from '../config/store'
import type {
  AgentMessage,
  AgentMessageTarget,
  AgentModelInfo,
  AgentThinkingLevel
} from '../shared/agent'
import { emptySessionSnapshot } from '../shared/agent-state'
import type { RuntimeInit, RuntimeSessionState } from '../shared/runtime'
import type { ToolApprovalMode } from '../shared/tool-approval'
import type { UserQuestionAnswer } from '../shared/user-question'
import { isTaskActive } from '../shared/background-tasks'
import {
  isSubagentActive,
  rootAgentId,
  type SubagentAction,
  type SubagentMessage
} from '../shared/subagents'
import { parseChatAttachmentMessage } from '../shared/chat-attachments'
import { createSettings, type RuntimeSettings } from './settings'
import { workspaceSessionDirectory } from './paths'
import { createEliModels, type EliModels } from './models'
import { EliResourceLoader } from './resources'
import { RuntimeInteractions } from './interactions'
import { configureNetwork } from './network'
import { reviewTool } from './auto-approval'
import { BackgroundTasks } from './background-tasks'
import { SubagentTeam } from './subagents'
import { createEngine } from './dsh/engine'
import { featurePlugins, featureProfile } from './dsh/features'
import { importLegacySession, readSessionIdentity } from './dsh/migration'
import {
  assistantView,
  importMessages,
  legacyTranscript,
  projectTranscript,
  saveSessionState,
  sessionState
} from './dsh/messages'
import type { PluginApplication } from '../plugins/kernel'

interface CollaborationBinding {
  team: SubagentTeam
  id: string
  directory: string
  messages?: AgentMessage[]
}

export function modelInfo({
  provider,
  id,
  contextWindow,
  reasoning
}: AgentModelInfo): AgentModelInfo {
  return { provider, id, contextWindow, reasoning }
}

/** 桌面会话的投影与命令适配器。模型循环、工具流水线和持久化均由 Cordis 服务实现。 */
export class RuntimeCoordinator {
  readonly snapshot
  readonly interactions: RuntimeInteractions
  private application?: PluginApplication
  private handle?: AgentHandle
  private settings!: RuntimeSettings
  private models!: EliModels
  private readonly efforts = new Map<
    string,
    { levels: AgentThinkingLevel[]; fallback: AgentThinkingLevel }
  >()
  private resources!: EliResourceLoader
  private backgroundTasks?: BackgroundTasks
  private team?: SubagentTeam
  private operation?: Promise<void>
  private closePromise?: Promise<void>
  private abortController?: AbortController
  private locked = false
  private disposed = false
  private submitted = false
  private created = Date.now()
  private modified = this.created
  private title = ''
  private path?: string
  private approvalCheckpoint = ''
  private approvalMode: ToolApprovalMode
  private stream?: BlockAssembler
  private streamIndex = -1
  private activeTools = new Set<string>()
  private abortRequested = false
  private compacting = false
  private pendingEdit?: {
    start: SessionSeq
    end: SessionSeq
    sources: SessionSeq[]
    messages: AgentMessage[]
    entryIds: (string | null)[]
  }
  private deferred: { text: string; wake: boolean; details?: SubagentMessage }[] = []

  constructor(
    private readonly options: Extract<RuntimeInit, { kind: 'session' }>,
    private readonly changed: (libraryChanged?: boolean) => void,
    private readonly collaboration?: CollaborationBinding
  ) {
    this.snapshot = emptySessionSnapshot(options.cwd, options.sessionKey, options.sessionFile)
    this.approvalMode = options.approvalMode
    this.interactions = new RuntimeInteractions(
      options.approvalMode,
      () => {
        if (this.agent) {
          const checkpoint = JSON.stringify(this.interactions.checkpoint)
          if (checkpoint !== this.approvalCheckpoint) {
            this.approvalCheckpoint = checkpoint
            saveSessionState(this.agent.session, 'eli.auto_approval', this.interactions.checkpoint)
          }
        }
        this.publish()
      },
      (request, signal) =>
        reviewTool({
          root: options.root,
          cwd: options.cwd,
          terminal: options.terminal.path,
          models: this.models.runtime,
          currentModel: this.selectedModel(),
          messages: this.snapshot.messages,
          request,
          previousDenial: this.interactions.autoApproval.lastDenied,
          signal
        })
    )
  }

  private get ctx(): Context {
    if (!this.application) throw new Error('会话尚未初始化')
    return this.application.ctx
  }
  private get agent(): Agent | undefined {
    return this.handle?.agent
  }

  async initialize(): Promise<void> {
    const { root, cwd, sessionKey, sessionFile } = this.options
    this.settings = await createSettings(root)
    if (!this.collaboration) await configureNetwork(this.settings)
    this.models = await createEliModels(root, undefined, (bytes, sessionId) => {
      if (!this.compacting && sessionId && sessionId === this.agent?.id) {
        this.snapshot.requestBodyBytes = bytes
        this.publish()
      }
    })
    this.resources = new EliResourceLoader(root, cwd, this.settings)
    await this.resources.reload()
    const directory = this.collaboration?.directory ?? workspaceSessionDirectory(root, cwd)
    const identity = sessionFile ? await readSessionIdentity(sessionFile) : sessionKey
    const createTeam = (): SubagentTeam => {
      if (this.collaboration) return this.collaboration.team
      const members = join(directory, 'subagents', identity)
      const team: SubagentTeam = new SubagentTeam(
        members,
        this,
        (member) =>
          new RuntimeCoordinator(
            {
              ...this.options,
              sessionKey: member.sessionId,
              sessionFile: member.sessionFile,
              approvalMode: this.approvalMode,
              selection: member.selection
            },
            (libraryChanged) => this.publish(libraryChanged),
            { team, id: member.id, directory: members, messages: member.messages }
          ),
        () => this.publish(true),
        (members) => {
          if (this.agent) saveSessionState(this.agent.session, 'eli.subagents', members)
        }
      )
      return team
    }
    const observer: Plugin = {
      inject: ['sessions', 'agents', 'tools', 'attachments', 'eliApprovals'],
      apply: (ctx) => this.observe(ctx)
    }
    this.application = await createEngine(
      { root, cwd, models: this.models, settings: this.settings },
      [
        ...featureProfile,
        { id: 'desktop-observer', name: 'eli.desktop-observer' },
        ...this.resources.getPlugins()
      ],
      {
        ...featurePlugins({
          interactions: this.interactions,
          createTasks: () => new BackgroundTasks(root, identity, () => this.publish()),
          createTeam,
          ownsTeam: !this.collaboration,
          caller: this.collaboration?.id ?? rootAgentId,
          terminal: this.options.terminal,
          resources: this.resources
        }),
        'eli.desktop-observer': observer
      }
    )
    this.team = this.ctx.get('eliTeam')
    const id = sessionFile
      ? await importLegacySession(
          this.ctx,
          sessionFile,
          this.collaboration ? 'subagent' : undefined
        )
      : SessionId(sessionKey)
    const stored = await this.ctx.sessionPersistence.stat(id)
    if (stored) {
      this.handle = await this.ctx.agents.resume({ resumeSessionId: id })
      this.created = stored.header.createdAt
      this.path = stored.location?.path
      this.submitted = true
    } else {
      let seed: readonly SessionEvent[] | undefined
      if (this.collaboration?.messages?.length) {
        const inherited = Session.create(id)
        await importMessages(inherited, this.collaboration.messages, this.ctx.attachments)
        seed = inherited.snapshotEvents()
      }
      this.handle = await this.ctx.agents.create({
        sessionId: id,
        ...(seed ? { seed } : {}),
        meta: { cwd, ...(this.collaboration ? { origin: 'subagent' as const } : {}) }
      })
    }
    this.backgroundTasks = this.ctx.get('eliTasks')
    const checkpoint = sessionState(this.agent!.session, 'eli.auto_approval')
    this.interactions.restoreCheckpoint(checkpoint)
    this.approvalCheckpoint = JSON.stringify(this.interactions.checkpoint)
    this.title = String(
      sessionState(this.agent!.session, 'eli.title') ??
        legacyTranscript(this.agent!.session.snapshotEvents())?.name ??
        ''
    )
    await this.selectInitialModel()
    if (!this.collaboration)
      await this.team?.restore(sessionState(this.agent!.session, 'eli.subagents'))
    this.sync()
    this.snapshot.connection = 'ready'
    this.publish()
  }

  async reloadPlugins(): Promise<void> {
    await this.application?.refresh()
    this.sync()
    this.publish()
  }
  pluginStatus(): import('../shared/plugins').PluginStatus[] {
    return this.application?.status() ?? []
  }
  projection(key: string): unknown {
    if (!this.agent || typeof key !== 'string' || !key || key.length > 200) return undefined
    const values = this.ctx.sessionProjections.snapshot(this.agent.session, [
      key as keyof import('@deepseek-ai/dsh-session-projection/types').SessionProjectionMap
    ]).values
    return Object.hasOwn(values, key) ? (values as Record<string, unknown>)[key] : undefined
  }

  private selectedModel(): ReturnType<EliModels['runtime']['getModel']> {
    const selection = this.agent?.model.current()
    return selection && this.ctx.get('eliPiRoutes')?.has(selection.provider)
      ? this.models.runtime.getModel(selection.provider, selection.model)
      : undefined
  }

  private async selectInitialModel(): Promise<void> {
    const settings = this.settings.getSettings()
    const patterns = settings.enabledModels
    const allowed = (model: { provider: string; id: string }): boolean =>
      !patterns?.length ||
      patterns.some((pattern) => {
        const expression = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')
        return new RegExp(`^${expression}$`, 'i').test(`${model.provider}/${model.id}`)
      })
    const routes = this.ctx.get('eliPiRoutes')
    const available: AgentModelInfo[] = []
    if (routes)
      for (const model of await this.models.runtime.getAvailable()) {
        if (!routes.has(model.provider) || !allowed(model)) continue
        available.push(modelInfo(model))
        this.efforts.set(JSON.stringify([model.provider, model.id]), {
          levels: getSupportedThinkingLevels(model),
          fallback: clampThinkingLevel(model, 'medium')
        })
      }
    for (const provider of this.ctx.llm.listProviders()) {
      if (routes?.has(provider.id)) continue
      for (const model of await this.ctx.llm.listModels(provider.id)) {
        if (!allowed(model)) continue
        const info = await this.ctx.llm.resolveModelInfo(provider.id, model.id)
        const levels =
          info.reasoning?.efforts
            .map(({ id }) => String(id))
            .filter((level): level is AgentThinkingLevel =>
              ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(level)
            ) ?? []
        const fallback =
          levels.find((level) => level === info.reasoning?.defaultEffort) ?? levels[0] ?? 'off'
        this.efforts.set(JSON.stringify([provider.id, model.id]), {
          levels: levels.length ? levels : ['off'],
          fallback
        })
        available.push({
          provider: provider.id,
          id: model.id,
          contextWindow: info.context?.contextWindow ?? 0,
          reasoning: levels.some((level) => level !== 'off')
        })
      }
    }
    this.snapshot.models = available
    const previous = this.agent!.model.current()
    const preferred =
      this.options.selection ??
      (previous
        ? {
            provider: previous.provider,
            modelId: previous.model,
            thinkingLevel: previous.reasoningEffort as AgentThinkingLevel
          }
        : {
            provider: settings.defaultProvider,
            modelId: settings.defaultModel,
            thinkingLevel: undefined
          })
    const requested = available.find(
      (model) => model.provider === preferred.provider && model.id === preferred.modelId
    )
    const selected = requested ?? available[0]
    if (selected) {
      const requestedLevel =
        preferred.thinkingLevel ??
        this.settings.getModelThinkingLevel(selected.provider, selected.id) ??
        this.settings.getDefaultThinkingLevel()
      const effort = this.efforts.get(JSON.stringify([selected.provider, selected.id]))!
      const level = effort.levels.includes(requestedLevel) ? requestedLevel : effort.fallback
      this.agent!.model.select({
        provider: selected.provider,
        model: selected.id,
        ...(selected.reasoning ? { reasoningEffort: ReasoningEffortId(level) } : {})
      })
      if (previous && !requested)
        this.snapshot.error = `原模型 ${previous.provider}/${previous.model} 当前不可用，已改用 ${selected.provider}/${selected.id}`
    } else if (this.submitted)
      this.snapshot.error = '请在模型供应商中配置当前会话可用的模型与凭据。'
  }

  state(): RuntimeSessionState {
    this.snapshot.toolApprovals = [...this.interactions.toolApprovals]
    this.snapshot.autoApproval = { ...this.interactions.autoApproval }
    this.snapshot.userQuestions = [...this.interactions.userQuestions]
    this.snapshot.backgroundTasks = this.backgroundTasks?.list() ?? []
    if (!this.collaboration && this.team) {
      this.snapshot.subagents = this.team.list()
      for (const member of this.snapshot.subagents) {
        if (!member.snapshot) continue
        this.snapshot.toolApprovals.push(
          ...member.snapshot.toolApprovals.map((request) => ({ ...request, agentId: member.id }))
        )
        this.snapshot.userQuestions.push(
          ...member.snapshot.userQuestions.map((request) => ({ ...request, agentId: member.id }))
        )
        this.snapshot.backgroundTasks.push(...member.snapshot.backgroundTasks)
        this.snapshot.autoApproval.reviewing += member.snapshot.autoApproval.reviewing
        this.snapshot.autoApproval.paused ||= member.snapshot.autoApproval.paused
        this.snapshot.autoApproval.lastDenied =
          member.snapshot.autoApproval.lastDenied ?? this.snapshot.autoApproval.lastDenied
      }
    }
    const firstUser = this.snapshot.messages.find((message) => message.role === 'user')
    const firstText =
      firstUser?.role === 'user'
        ? typeof firstUser.content === 'string'
          ? firstUser.content
          : firstUser.content
              .filter((part) => part.type === 'text')
              .map((part) => part.text)
              .join('\n')
        : ''
    const title = (this.title || firstText || '未命名对话').replace(/\s+/g, ' ').slice(0, 160)
    return {
      snapshot: this.snapshot,
      persistedFile: this.path && existsSync(this.path) ? this.path : undefined,
      summary: this.submitted
        ? {
            key: this.options.sessionKey,
            path: this.path ?? this.options.sessionKey,
            id: this.agent?.id ?? this.options.sessionKey,
            cwd: this.options.cwd,
            title,
            created: this.created,
            modified: this.modified,
            messageCount: this.snapshot.messages.length,
            running: this.snapshot.running,
            pending: this.snapshot.pending,
            approvalCount: this.snapshot.toolApprovals.length,
            questionCount: this.snapshot.userQuestions.length,
            backgroundTaskCount: this.snapshot.backgroundTasks.filter(isTaskActive).length,
            subagentCount: this.snapshot.subagents.filter(isSubagentActive).length
          }
        : null
    }
  }

  private sync(): void {
    if (!this.agent) return
    const projected = projectTranscript(
      this.agent.session.snapshotEvents(),
      this.ctx.attachments,
      this.models.runtime.getModel.bind(this.models.runtime)
    )
    this.snapshot.messages = projected.messages
    this.snapshot.messageEntryIds = projected.entryIds
    const choice = this.agent.model.current()
    const selected = this.snapshot.models.find(
      (model) => model.provider === choice?.provider && model.id === choice?.model
    )
    this.snapshot.model = selected ?? null
    this.snapshot.thinkingLevels = selected
      ? this.efforts.get(JSON.stringify([selected.provider, selected.id]))!.levels
      : ['off']
    this.snapshot.session = {
      sessionId: this.agent.id,
      sessionFile: this.path,
      sessionName: this.title,
      thinkingLevel: (choice?.reasoningEffort ?? 'off') as AgentThinkingLevel
    }
    this.snapshot.hideThinkingBlock = this.settings.getHideThinkingBlock()
    const tokens = this.ctx.tokenMeter.measure(this.agent.session).totalTokens
    this.snapshot.contextUsage = selected?.contextWindow
      ? {
          tokens,
          contextWindow: selected.contextWindow,
          percent: (tokens / selected.contextWindow) * 100
        }
      : null
  }

  private publish(libraryChanged = false): void {
    if (!this.disposed) this.changed(libraryChanged)
  }
  private assertIdle(): void {
    if (this.disposed) throw new Error('会话已关闭')
    if (this.locked || this.operation || this.agent?.status === 'running')
      throw new Error('请等待当前操作完成')
  }
  private async flush(): Promise<void> {
    if (!this.agent || !this.submitted) return
    await this.ctx.sessionPersistence.flush()
    this.path = (await this.ctx.sessionPersistence.stat(this.agent.id))?.location?.path
    if (this.snapshot.session) this.snapshot.session.sessionFile = this.path
  }
  private async mutate<T>(action: () => Promise<T>): Promise<T> {
    this.assertIdle()
    this.locked = true
    this.snapshot.pending = true
    this.publish()
    try {
      return await action()
    } finally {
      this.locked = false
      this.snapshot.pending = false
      await this.flush()
      this.sync()
      this.publish(true)
      for (const message of this.deferred.splice(0))
        this.collaborationMessage(message.text, message.wake, message.details)
    }
  }

  private startRun(action: () => Promise<void>, title?: string): void {
    if (!this.collaboration) this.team?.begin()
    this.abortRequested = false
    this.abortController = new AbortController()
    this.interactions.begin()
    this.snapshot.running = true
    this.snapshot.error = null
    this.snapshot.activity = ''
    this.snapshot.response = {
      id: this.snapshot.response.id + 1,
      messageIndex: this.snapshot.messages.length,
      phase: 'sending',
      toolCallDrafts: {}
    }
    if (title) {
      this.submitted = true
      this.title ||= title.replace(/\s+/g, ' ').slice(0, 160)
    }
    this.modified = Date.now()
    this.publish(true)
    this.operation = Promise.resolve()
      .then(action)
      .then(() => this.flush())
      .catch((error: unknown) => {
        if (!this.abortRequested)
          this.snapshot.error = error instanceof Error ? error.message : String(error)
      })
      .finally(() => {
        this.interactions.cancel()
        this.stream = undefined
        this.sync()
        this.snapshot.running = false
        this.snapshot.response.phase = 'idle'
        this.snapshot.response.toolCallDrafts = {}
        this.snapshot.activeThinking = null
        this.activeTools.clear()
        if (this.abortRequested) this.snapshot.activity = '已停止'
        this.modified = Date.now()
        this.operation = undefined
        this.pendingEdit = undefined
        this.publish(true)
        if (this.collaboration) this.team?.settled(this.collaboration.id)
      })
  }

  private async promptContent(text: string): Promise<ContentBlock[]> {
    const content: ContentBlock[] = [{ type: 'text', text: this.resources.expandPrompt(text) }]
    const mediaTypes: Record<string, ImageMediaType> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif': 'image/gif'
    }
    for (const { path } of parseChatAttachmentMessage(text).attachments) {
      const mediaType = mediaTypes[extname(path).toLowerCase()]
      if (!mediaType || this.settings.getSettings().images?.blockImages) continue
      const data = await readFile(path, { signal: this.abortController?.signal })
      content.push({
        type: 'image',
        attachment: await this.ctx.attachments.saveImage({ data, mediaType })
      })
    }
    return content
  }

  prompt(text: string): void {
    this.assertIdle()
    if (typeof text !== 'string' || !text.trim() || text.length > 100000)
      throw new Error('无效的消息')
    const command = parseCommand(text)
    if (command && this.ctx.commands.find(this.agent!, command.name)) {
      this.startRun(async () => {
        const execution = await this.ctx.commands.execute(
          this.agent!,
          text,
          [],
          this.abortController!.signal
        )
        if (execution?.result.text) this.snapshot.error = execution.result.text
        await this.agent!.whenIdle()
      })
      return
    }
    if (!this.snapshot.model) throw new Error('请先配置模型，再重新连接')
    this.startRun(async () => {
      const content = await this.promptContent(text)
      this.abortController?.signal.throwIfAborted()
      this.agent!.followup(createUserMessage({ content, source: { kind: 'user' } }))
      await this.agent!.whenIdle()
    }, text)
  }

  inheritedMessages(): AgentMessage[] {
    const messages = structuredClone(this.snapshot.messages)
    const last = messages.findLastIndex(
      (message) =>
        message.role === 'assistant' && message.content.some((part) => part.type === 'toolCall')
    )
    const assistant = messages[last]
    if (assistant?.role === 'assistant') {
      const results = new Set(
        messages
          .slice(last + 1)
          .flatMap((message) => (message.role === 'toolResult' ? [message.toolCallId] : []))
      )
      if (assistant.content.some((part) => part.type === 'toolCall' && !results.has(part.id)))
        messages.splice(last)
    }
    return messages
  }

  collaborationMessage(text: string, wake: boolean, details?: SubagentMessage): void {
    if (this.disposed || !this.agent) return
    if (this.locked) {
      this.deferred.push({ text, wake, details })
      return
    }
    const message = createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'eli-collaboration', form: 'relay' }
    })
    appendPluginRecord(
      this.agent.session,
      'plugin:eli/collaboration',
      JSON.parse(JSON.stringify({ messageId: message.id, text, details }))
    )
    if (this.operation || this.agent.status === 'running') this.agent.steer(message)
    else if (wake)
      this.startRun(async () => {
        this.agent!.followup(message)
        await this.agent!.whenIdle()
      })
    else this.agent.inject(message)
    this.sync()
    this.publish(true)
  }

  configure(mode: ToolApprovalMode): void {
    this.approvalMode = mode
    this.interactions.setMode(mode)
    if (!this.collaboration) this.team?.configure(mode)
  }
  respondApproval(id: string, approved: boolean): void {
    const owner = [this, ...(this.team?.allRuntimes() ?? []).map(({ runtime }) => runtime)].find(
      (runtime) => runtime.interactions.toolApprovals.some((request) => request.id === id)
    )
    if (!owner) throw new Error('该工具审批已失效')
    owner.interactions.respondApproval(id, approved)
  }
  respondQuestion(id: string, answers: UserQuestionAnswer[]): void {
    const owner = [this, ...(this.team?.allRuntimes() ?? []).map(({ runtime }) => runtime)].find(
      (runtime) => runtime.interactions.userQuestions.some((request) => request.id === id)
    )
    if (!owner) throw new Error('该用户提问已失效')
    owner.interactions.respondQuestion(id, answers)
  }
  async controlSubagent(action: SubagentAction): Promise<void> {
    if (this.collaboration || this.disposed) throw new Error('会话已关闭或不是主会话')
    if (!this.team) throw new Error('协作插件未启用')
    await this.team.control(action)
  }
  async abort(): Promise<void> {
    this.abortRequested = true
    this.deferred = []
    this.abortController?.abort()
    this.interactions.cancel()
    this.agent?.cancel({ kind: 'user' })
    this.publish()
    await Promise.all([
      this.agent?.whenIdle(),
      !this.collaboration ? this.team?.abortAll() : undefined
    ])
    await this.operation
  }
  stopBackgroundTask(id: string): void {
    if (typeof id !== 'string') throw new Error('无效的后台任务 ID')
    const owner = !this.collaboration
      ? this.team
          ?.allRuntimes()
          .find(({ runtime }) =>
            runtime.state().snapshot.backgroundTasks.some((task) => task.id === id)
          )
      : undefined
    if (owner) owner.runtime.stopBackgroundTask(id)
    else if (this.backgroundTasks) this.backgroundTasks.stop(id)
    else throw new Error('终端插件未启用')
    this.publish()
  }
  compact(instructions?: string): void {
    this.assertIdle()
    if (!this.snapshot.messages.length) return
    this.startRun(async () => {
      this.compacting = true
      saveSessionState(this.agent!.session, 'eli.compaction-request', {
        instructions: instructions ?? '',
        textOnly: true
      })
      this.snapshot.activity = '正在整理上下文'
      this.publish()
      try {
        await this.ctx.compaction.compactNow(this.agent!, this.abortController!.signal)
      } finally {
        this.compacting = false
      }
      this.snapshot.activity = '上下文压缩完成'
    })
  }
  async setModel(provider: string, id: string): Promise<void> {
    await this.mutate(async () => {
      const model = this.snapshot.models.find(
        (model) => model.provider === provider && model.id === id
      )
      if (!model) throw new Error('请选择可用的模型')
      const effort = this.efforts.get(JSON.stringify([provider, id]))!
      const current = this.snapshot.session?.thinkingLevel ?? 'medium'
      const level = effort.levels.includes(current) ? current : effort.fallback
      this.agent!.model.select({
        provider,
        model: id,
        ...(model.reasoning ? { reasoningEffort: ReasoningEffortId(level) } : {})
      })
      this.snapshot.requestBodyBytes = null
      await new EliConfigStore(join(this.options.root, 'config.json')).update(({ agent }) => {
        agent.defaultProvider = provider
        agent.defaultModel = id
      })
    })
  }
  async setThinkingLevel(level: AgentThinkingLevel): Promise<void> {
    await this.mutate(async () => {
      if (!this.snapshot.thinkingLevels.includes(level)) throw new Error('当前模型不支持该思考强度')
      const selection = this.agent!.model.current()!
      this.agent!.model.select({
        provider: selection.provider,
        model: selection.model,
        ...(this.snapshot.model?.reasoning ? { reasoningEffort: ReasoningEffortId(level) } : {})
      })
      await new EliConfigStore(join(this.options.root, 'config.json')).update(({ agent }) => {
        agent.defaultThinkingLevel = level
      })
    })
  }
  getSkills(): import('../shared/agent').AgentSkillCommand[] {
    return this.settings.getEnableSkillCommands()
      ? this.resources
          .getSkills()
          .skills.map(({ name, description }) => ({ name: `skill:${name}`, description }))
      : []
  }

  private target(target: AgentMessageTarget, role: 'user' | 'assistant'): number {
    if (target.sessionId !== this.agent?.id) throw new Error('会话已变化，请重新选择消息')
    const index = this.snapshot.messageEntryIds.indexOf(target.entryId)
    if (index < 0 || this.snapshot.messages[index]?.role !== role)
      throw new Error('该消息已不在当前会话中')
    return index
  }
  async forkMessage(target: AgentMessageTarget): Promise<string> {
    return this.mutate(async () => {
      const index = this.target(target, 'assistant')
      const id = SessionId(randomUUID())
      let seed: readonly SessionEvent[]
      let inheritedEventCount: SessionLogOffset
      if (target.entryId.startsWith('legacy:')) {
        const imported = Session.create(id)
        await importMessages(
          imported,
          this.snapshot.messages.slice(0, index + 1),
          this.ctx.attachments
        )
        inheritedEventCount = SessionLogOffset(imported.snapshotEvents().length)
        seed = buildForkSeed(imported.snapshotEvents(), SessionSeq(inheritedEventCount - 1))
      } else {
        const boundary = SessionSeq(Number(target.entryId))
        seed = buildForkSeed(this.agent!.session.snapshotEvents(), boundary)
        inheritedEventCount = SessionLogOffset(boundary + 1)
      }
      const fork = await this.ctx.agents.create({
        sessionId: id,
        seed,
        inheritedEventCount,
        meta: { cwd: this.options.cwd, isSeeded: true },
        agentOptions: this.agent!.options
      })
      try {
        saveSessionState(
          fork.agent.session,
          'eli.title',
          `${this.state().summary?.title ?? '新对话'} · 分叉`
        )
        await this.ctx.sessionPersistence.flush()
        const path = (await this.ctx.sessionPersistence.stat(id))?.location?.path
        if (!path) throw new Error('分叉会话尚未持久化')
        return path
      } finally {
        await fork.dispose()
      }
    })
  }

  async editMessage(target: AgentMessageTarget, text: string): Promise<void> {
    let images: ContentBlock[] = []
    await this.mutate(async () => {
      const index = this.target(target, 'user')
      if (target.entryId.startsWith('legacy:'))
        throw new Error('旧会话的原始消息保留为只读；请先从回复分叉后编辑新消息')
      const session = this.agent!.session
      const event = session.snapshotEvents()[Number(target.entryId)]
      if (event.type !== 'user/message') throw new Error('消息事件无效')
      images = event.data.content.filter((block) => block.type === 'image')
      const nodes = session.surface.nodes
      const start = nodes.findIndex((seq) => seq === event.seq)
      if (start < 0) throw new Error('该消息已被压缩，无法直接编辑')
      const replaced = nodes.slice(start)
      const last = replaced.at(-1)!
      this.pendingEdit = {
        start: event.seq,
        end: last,
        sources: [...replaced],
        messages: this.snapshot.messages.slice(0, index),
        entryIds: this.snapshot.messageEntryIds.slice(0, index)
      }
    })
    this.startRun(async () => {
      const content = await this.promptContent(text)
      this.agent!.followup(
        createUserMessage({ content: [...content, ...images], source: { kind: 'user' } })
      )
      await this.agent!.whenIdle()
    }, text)
  }

  private observe(ctx: Context): void {
    ctx.on('agent/request', async ({ agent, turn, step }, next) => {
      const config = await next()
      if (agent === this.agent && this.pendingEdit) {
        const edit = this.pendingEdit
        this.pendingEdit = undefined
        const throughSeq = agent.session.snapshotEvents().length - 1
        agent.session.append(
          'system/message',
          { turn, step, message: createSystemMessage('') },
          {
            surfaceOp: { op: 'replace', startSeq: edit.start, endSeq: edit.end },
            sourceEventSeqs: edit.sources
          }
        )
        saveSessionState(agent.session, 'eli.branch', {
          throughSeq,
          messages: edit.messages,
          entryIds: edit.entryIds
        })
      }
      return config
    })
    ctx.on('session/event', (session, event) => {
      if (session !== this.agent?.session) return
      if (event.type === 'turn/end' && event.data.reason.kind === 'error')
        this.snapshot.error = event.data.reason.error.message
      if (event.type === 'tool/call') {
        this.activeTools.add(event.data.callId)
        this.snapshot.tools[event.data.callId] = {
          type: 'tool_execution_start',
          toolCallId: event.data.callId,
          toolName: event.data.name,
          args: (() => {
            try {
              return JSON.parse(event.data.arguments)
            } catch {
              return {}
            }
          })()
        }
        this.snapshot.response.phase = 'tool-running'
      }
      if (event.type === 'tool/result') {
        const id = event.data.message.toolCallId
        this.activeTools.delete(id)
        const result = projectTranscript(
          session.snapshotEvents(),
          ctx.attachments,
          this.models.runtime.getModel.bind(this.models.runtime)
        ).messages.findLast((message) => message.role === 'toolResult' && message.toolCallId === id)
        this.snapshot.tools[id] = {
          type: 'tool_execution_end',
          toolCallId: id,
          toolName: this.snapshot.tools[id]?.toolName ?? '',
          result: result?.role === 'toolResult' ? result : { content: [] },
          isError: event.data.message.isError ?? false
        }
      }
      if (
        ['user/message', 'assistant/message', 'assistant/attempt', 'tool/result'].includes(
          event.type
        )
      )
        this.sync()
      if (event.type === 'assistant/message') {
        const assistant = this.snapshot.messages.findLast((message) => message.role === 'assistant')
        if (assistant?.role === 'assistant')
          saveSessionState(session, `eli.usage:${event.seq}`, { cost: assistant.usage.cost.total })
      }
      this.modified = Date.now()
      this.publish(true)
    })
    ctx.on('agent/assistant-stream', ({ agent, frame }) => {
      if (agent === this.agent) this.onStream(frame)
    })
    ctx.on('agent/error', ({ agent, error }) => {
      if (agent === this.agent) {
        this.snapshot.error = error instanceof Error ? error.message : String(error)
        this.publish()
      }
    })
  }

  private onStream(frame: AssistantStreamFrame): void {
    if (frame.type === 'start') {
      this.stream = new BlockAssembler()
      this.streamIndex = this.snapshot.messages.length
      this.snapshot.response.phase = 'waiting'
    } else if (frame.type === 'chunk' && this.stream) {
      const chunk = frame.chunk
      this.stream.push(chunk)
      const model = this.selectedModel()
      const selection = this.agent!.model.current()!
      this.snapshot.messages[this.streamIndex] = assistantView(
        this.stream.blocks(),
        selection,
        frame.time,
        model,
        this.stream.usage,
        this.stream.finish
      )
      this.snapshot.messageEntryIds[this.streamIndex] = null
      if (chunk.type === 'reasoning-delta') {
        this.snapshot.response.phase = 'thinking'
        this.snapshot.activeThinking = { messageIndex: this.streamIndex, contentIndex: chunk.index }
      }
      if (chunk.type === 'text-delta') {
        this.snapshot.response.phase = 'text'
        this.snapshot.activeThinking = null
      }
      if (chunk.type === 'tool-call-delta') {
        this.snapshot.response.phase = 'tool-call'
        this.snapshot.activeThinking = null
        this.snapshot.response.toolCallDrafts[chunk.id] =
          (this.snapshot.response.toolCallDrafts[chunk.id] ?? '') + chunk.argumentsDelta
      }
      if (chunk.type === 'block-end' && chunk.block.type === 'tool-call')
        delete this.snapshot.response.toolCallDrafts[chunk.block.id]
    } else if (frame.type === 'end') {
      this.stream = undefined
      this.streamIndex = -1
      this.snapshot.activeThinking = null
      this.snapshot.response.toolCallDrafts = {}
      this.sync()
    }
    this.publish()
  }

  dispose(): Promise<void> {
    this.closePromise ??= (async () => {
      this.disposed = true
      await this.abort()
      if (!this.collaboration) await this.team?.close()
      await this.backgroundTasks?.close()
      await this.application?.dispose()
    })()
    return this.closePromise
  }
}
