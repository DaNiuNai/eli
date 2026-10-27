import { stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { EliConfigStore } from '../config/store'
import {
  createAgentSession,
  type ModelRuntime,
  SessionManager,
  resolveModelScopeWithDiagnostics,
  type AgentSession,
  type AgentSessionEvent,
  type SettingsManager
} from '@earendil-works/pi-coding-agent'
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai'
import type {
  AgentMessage,
  AgentMessageTarget,
  AgentModelInfo,
  AgentThinkingLevel
} from '../shared/agent'
import { emptySessionSnapshot } from '../shared/agent-state'
import type { RuntimeInit, RuntimeSessionState } from '../shared/runtime'
import { createSettings } from './settings'
import { workspaceSessionDirectory } from './paths'
import { createModels } from './models'
import { EliResourceLoader } from './resources'
import { RuntimeInteractions } from './interactions'
import { hostExtension } from './host-extension'
import { mapMessageEntryIds } from './history'
import { configureNetwork } from './network'
import { desktopExtensionUi } from './extension-ui'
import { reviewTool } from './auto-approval'
import { BackgroundTasks } from './background-tasks'
import { isTaskActive } from '../shared/background-tasks'
import {
  isSubagentActive,
  rootAgentId,
  type SubagentAction,
  type SubagentMessage
} from '../shared/subagents'
import { SubagentTeam } from './subagents'
import type { ToolApprovalMode } from '../shared/tool-approval'
import type { UserQuestionAnswer } from '../shared/user-question'

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

/** 单个 Agent 的 SDK 生命周期；主成员同时持有当前用户会话的协作团队。 */
export class RuntimeCoordinator {
  readonly snapshot
  readonly interactions: RuntimeInteractions
  private agent!: AgentSession
  private settings!: SettingsManager
  private models!: ModelRuntime
  private loader!: EliResourceLoader
  private unsubscribe?: () => void
  private operation?: Promise<void>
  private locked = false
  private disposed = false
  private submitted = false
  private created = Date.now()
  private modified = this.created
  private title = ''
  private activeMessage = -1
  private activeTools = new Set<string>()
  private abortRequested = false
  private approvalCheckpoint = ''
  private backgroundTasks!: BackgroundTasks
  private team!: SubagentTeam
  private approvalMode: ToolApprovalMode
  private deferredCollaboration: { text: string; wake: boolean; details?: SubagentMessage }[] = []

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
        this.persistApprovalCheckpoint()
        this.publish()
      },
      (request, signal) =>
        reviewTool({
          root: options.root,
          cwd: options.cwd,
          terminal: options.terminal.path,
          models: this.models,
          currentModel: this.agent.model,
          messages: this.agent.sessionManager
            .getBranch()
            .flatMap((entry) => (entry.type === 'message' ? [entry.message] : [])),
          request,
          previousDenial: this.interactions.autoApproval.lastDenied,
          signal
        })
    )
  }

  private persistApprovalCheckpoint(): void {
    const checkpoint = JSON.stringify(this.interactions.checkpoint)
    if (this.agent && checkpoint !== this.approvalCheckpoint) {
      this.agent.sessionManager.appendCustomEntry('eli.auto_approval', this.interactions.checkpoint)
      this.approvalCheckpoint = checkpoint
    }
  }

  async initialize(): Promise<void> {
    const { root, cwd, sessionFile, sessionKey, selection } = this.options
    this.settings = await createSettings(root)
    // 同一 Runtime 的所有成员共享连接池，创建成员不能关闭其他成员正在使用的连接。
    if (!this.collaboration) await configureNetwork(this.settings)
    this.models = await createModels(root)
    const directory = this.collaboration?.directory ?? workspaceSessionDirectory(root, cwd)
    const manager = sessionFile
      ? SessionManager.open(sessionFile, directory)
      : SessionManager.create(cwd, directory, { id: sessionKey })
    if (!sessionFile && this.collaboration?.messages) {
      for (const message of this.collaboration.messages) {
        if (message.role === 'branchSummary' || message.role === 'compactionSummary') {
          manager.appendCustomMessageEntry('eli.inherited-context', message.summary, false)
        } else manager.appendMessage(message)
      }
    }
    if (sessionFile) {
      const info = await stat(sessionFile)
      this.created = new Date(manager.getHeader()?.timestamp ?? info.birthtimeMs).getTime()
      this.modified = info.mtimeMs
      this.submitted = true
    }
    this.backgroundTasks = new BackgroundTasks(root, manager.getSessionId(), () => this.publish())
    if (this.collaboration) this.team = this.collaboration.team
    else {
      const memberDirectory = join(directory, 'subagents', manager.getSessionId())
      this.team = new SubagentTeam(
        memberDirectory,
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
            () => this.publish(true),
            {
              team: this.team,
              id: member.id,
              directory: memberDirectory,
              messages: member.messages
            }
          ),
        () => this.publish(true),
        (members) => manager.appendCustomEntry('eli.subagents', members)
      )
    }
    await this.openAgent(manager, selection)
    if (!this.collaboration) {
      const checkpoint = manager
        .getBranch()
        .findLast((entry) => entry.type === 'custom' && entry.customType === 'eli.subagents')
      await this.team.restore(checkpoint?.type === 'custom' ? checkpoint.data : undefined)
    }
    this.sync()
    this.snapshot.connection = 'ready'
    this.publish()
  }

  private async openAgent(
    manager: SessionManager,
    selection = this.options.selection
  ): Promise<void> {
    const previous = manager.buildSessionProjection()
    const preferred = selection ??
      previous.model ?? {
        provider: this.settings.getDefaultProvider(),
        modelId: this.settings.getDefaultModel()
      }
    this.loader = new EliResourceLoader(
      this.options.root,
      this.options.cwd,
      this.settings,
      hostExtension(
        this.interactions,
        this.options.terminal,
        () => this.agent.agent,
        this.backgroundTasks,
        { team: this.team, id: this.collaboration?.id ?? rootAgentId }
      )
    )
    await this.loader.reload()
    const { session } = await createAgentSession({
      cwd: this.options.cwd,
      agentDir: this.options.root,
      modelRuntime: this.models,
      settingsManager: this.settings,
      sessionManager: manager,
      resourceLoader: this.loader,
      model: selection ? this.models.getModel(selection.provider, selection.modelId) : undefined,
      thinkingLevel: selection?.thinkingLevel
    })
    this.agent = session
    const checkpoint = manager
      .getBranch()
      .findLast((entry) => entry.type === 'custom' && entry.customType === 'eli.auto_approval')
    const saved = checkpoint?.type === 'custom' ? checkpoint.data : undefined
    this.interactions.restoreCheckpoint(saved)
    this.approvalCheckpoint = JSON.stringify(saved ?? this.interactions.checkpoint)
    this.persistApprovalCheckpoint()
    this.unsubscribe = session.subscribe((event) => this.onEvent(event))
    await session.bindExtensions({
      uiContext: desktopExtensionUi(session.extensionRunner.getUIContext(), (message) => {
        this.snapshot.error = message
        this.publish()
      }),
      onError: ({ error }) => {
        this.snapshot.error = error
        this.publish()
      },
      abortHandler: () => {
        void this.abort()
      },
      shutdownHandler: () => {
        void this.abort()
      }
    })
    // 扩展绑定完成后再解析范围，它们可能注册自定义提供商或模型。
    await this.models.refresh({ allowNetwork: false })
    const patterns = this.settings.getEnabledModels()
    const scoped = patterns?.length
      ? (await resolveModelScopeWithDiagnostics(patterns, this.models)).scopedModels
      : undefined
    session.setScopedModels(scoped ?? [])
    const available = scoped ? scoped.map(({ model }) => model) : await this.models.getAvailable()
    const preferredModel = available.find(
      (model) => model.provider === preferred.provider && model.id === preferred.modelId
    )
    const selected =
      preferredModel ??
      available.find(
        (model) => model.provider === session.model?.provider && model.id === session.model.id
      ) ??
      available[0]
    if (
      selected &&
      (selected.provider !== session.model?.provider || selected.id !== session.model.id)
    ) {
      await session.setModel(selected)
      session.setThinkingLevel(
        selection?.thinkingLevel ??
          (previous.messages.length ? (previous.thinkingLevel as AgentThinkingLevel) : undefined) ??
          this.settings.getModelThinkingLevel(selected.provider, selected.id) ??
          this.settings.getDefaultThinkingLevel() ??
          'medium'
      )
    }
    this.snapshot.models = available.map(modelInfo)
    if (!selected && previous.messages.length)
      this.snapshot.error = '请在模型供应商中配置当前会话可用的模型与凭据。'
    else if (selected && previous.model && !preferredModel) {
      this.snapshot.error = `原模型 ${previous.model.provider}/${previous.model.modelId} 当前不可用，已改用 ${selected.provider}/${selected.id}`
    }
  }

  state(): RuntimeSessionState {
    this.snapshot.toolApprovals = this.interactions.toolApprovals
    this.snapshot.autoApproval = this.interactions.autoApproval
    this.snapshot.userQuestions = this.interactions.userQuestions
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
        this.snapshot.autoApproval = {
          reviewing: this.snapshot.autoApproval.reviewing + member.snapshot.autoApproval.reviewing,
          paused: this.snapshot.autoApproval.paused || member.snapshot.autoApproval.paused,
          lastDenied:
            member.snapshot.autoApproval.lastDenied ?? this.snapshot.autoApproval.lastDenied
        }
      }
    }
    const manager = this.agent?.sessionManager
    const file = manager?.getSessionFile()
    const persisted = file && existsSync(file) ? file : undefined
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
    const title = (manager?.getSessionName() || firstText || this.title || '未命名对话')
      .replace(/\s+/g, ' ')
      .slice(0, 160)
    return {
      snapshot: this.snapshot,
      persistedFile: persisted,
      summary: this.submitted
        ? {
            key: this.options.sessionKey,
            path: file ?? this.options.sessionKey,
            id: manager?.getSessionId() ?? this.options.sessionKey,
            cwd: this.snapshot.cwd,
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
    const session = this.agent
    const manager = session.sessionManager
    this.snapshot.session = {
      sessionId: manager.getSessionId(),
      sessionFile: manager.getSessionFile(),
      sessionName: manager.getSessionName(),
      thinkingLevel: session.thinkingLevel
    }
    this.snapshot.messages = [...session.messages]
    this.snapshot.messageEntryIds = mapMessageEntryIds(
      this.snapshot.messages,
      manager.buildSessionProjection()
    )
    this.snapshot.model =
      session.model && this.snapshot.models.length ? modelInfo(session.model) : null
    this.snapshot.thinkingLevels = session.model
      ? getSupportedThinkingLevels(session.model)
      : ['off']
    this.snapshot.contextUsage = session.getContextUsage() ?? null
    this.snapshot.hideThinkingBlock = this.settings.getHideThinkingBlock()
    this.activeMessage = -1
  }

  private publish(libraryChanged = false): void {
    if (!this.disposed) this.changed(libraryChanged)
  }

  private assertIdle(): void {
    if (this.disposed) throw new Error('会话已关闭')
    if (this.locked || this.operation || this.snapshot.running || this.agent.isStreaming)
      throw new Error('请等待当前操作完成')
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
      this.sync()
      this.publish(true)
      for (const message of this.deferredCollaboration.splice(0))
        this.collaborationMessage(message.text, message.wake, message.details)
    }
  }

  prompt(text: string): void {
    this.assertIdle()
    if (!this.snapshot.model) throw new Error('请先配置模型，再重新连接')
    if (typeof text !== 'string' || !text.trim() || text.length > 100_000)
      throw new Error('无效的消息')
    this.startRun(() => this.agent.prompt(text), text)
  }

  inheritedMessages(): AgentMessage[] {
    const messages = [...this.agent.messages]
    // 创建成员时当前工具批次还未结束，截去未配齐结果的整个批次，避免无效的调用序列。
    const lastCall = messages.findLastIndex(
      (message) =>
        message.role === 'assistant' && message.content.some((part) => part.type === 'toolCall')
    )
    if (lastCall >= 0) {
      const assistant = messages[lastCall]
      if (assistant.role === 'assistant') {
        const results = new Set(
          messages
            .slice(lastCall + 1)
            .flatMap((message) => (message.role === 'toolResult' ? [message.toolCallId] : []))
        )
        if (assistant.content.some((part) => part.type === 'toolCall' && !results.has(part.id)))
          messages.splice(lastCall)
      }
    }
    return structuredClone(messages)
  }

  collaborationMessage(text: string, wake: boolean, details?: SubagentMessage): void {
    if (this.disposed) return
    if (this.locked && !this.operation) {
      this.deferredCollaboration.push({ text, wake, details })
      return
    }
    const message = { customType: 'eli.collaboration', content: text, display: true, details }
    if (this.operation || this.snapshot.running) {
      // 不等待当前轮结束；SDK 在工具结果边界递送，不破坏 toolCall / toolResult 顺序。
      void this.agent.sendCustomMessage(message, { deliverAs: 'steer' }).catch((error: unknown) => {
        this.snapshot.error = error instanceof Error ? error.message : String(error)
        this.publish()
      })
    } else if (wake) {
      this.startRun(() => this.agent.sendCustomMessage(message, { triggerTurn: true }))
    } else {
      void this.agent.sendCustomMessage(message).catch((error: unknown) => {
        this.snapshot.error = error instanceof Error ? error.message : String(error)
        this.publish()
      })
    }
  }

  configure(mode: ToolApprovalMode): void {
    this.approvalMode = mode
    this.interactions.setMode(mode)
    if (!this.collaboration) this.team.configure(mode)
  }

  respondApproval(id: string, approved: boolean): void {
    const owner = [this, ...this.team.allRuntimes().map(({ runtime }) => runtime)].find((runtime) =>
      runtime.interactions.toolApprovals.some((request) => request.id === id)
    )
    if (!owner) throw new Error('该工具审批已失效')
    owner.interactions.respondApproval(id, approved)
  }

  respondQuestion(id: string, answers: UserQuestionAnswer[]): void {
    const owner = [this, ...this.team.allRuntimes().map(({ runtime }) => runtime)].find((runtime) =>
      runtime.interactions.userQuestions.some((request) => request.id === id)
    )
    if (!owner) throw new Error('该用户提问已失效')
    owner.interactions.respondQuestion(id, answers)
  }

  async controlSubagent(action: SubagentAction): Promise<void> {
    if (this.collaboration || this.disposed) throw new Error('会话已关闭或不是主会话')
    await this.team.control(action)
  }

  private startRun(action: () => Promise<void>, title?: string): void {
    if (!this.collaboration) this.team.begin()
    this.abortRequested = false
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
      this.title ||= title
    }
    this.modified = Date.now()
    this.publish(true)
    // prompt() 直到整轮重试结束才 resolve；接收命令立即返回，运行完成由状态事件确认。
    this.operation = Promise.resolve()
      .then(action)
      .catch((error: unknown) => {
        if (!this.abortRequested)
          this.snapshot.error = error instanceof Error ? error.message : String(error)
      })
      .finally(() => {
        this.interactions.cancel()
        this.sync()
        this.snapshot.running = false
        this.snapshot.response.phase = 'idle'
        this.snapshot.response.toolCallDrafts = {}
        this.snapshot.activeThinking = null
        this.activeTools.clear()
        this.snapshot.activity = this.abortRequested ? '已停止' : this.snapshot.activity
        this.modified = Date.now()
        this.operation = undefined
        this.publish(true)
        if (this.collaboration) this.team.settled(this.collaboration.id)
      })
  }

  compact(instructions?: string): void {
    this.assertIdle()
    this.startRun(async () => {
      this.snapshot.activity = '正在整理上下文'
      this.publish()
      try {
        await this.agent.compact(instructions)
        this.snapshot.activity = '上下文压缩完成'
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message === 'Nothing to compact (session too small)')
          this.snapshot.activity = '当前没有可压缩的历史内容，可继续对话'
        else if (message === 'Already compacted')
          this.snapshot.activity = '当前上下文已压缩，暂无新的内容需要整理'
        else throw error
      }
    })
  }

  async abort(): Promise<void> {
    this.abortRequested = true
    this.deferredCollaboration = []
    this.snapshot.activity = '正在停止'
    this.interactions.cancel()
    this.publish()
    await Promise.all([
      this.agent?.abort(),
      !this.collaboration ? this.team?.abortAll() : undefined
    ])
    await this.operation
  }

  stopBackgroundTask(id: string): void {
    if (typeof id !== 'string') throw new Error('无效的后台任务 ID')
    const owner = !this.collaboration
      ? this.team
          .allRuntimes()
          .find(({ runtime }) =>
            runtime.state().snapshot.backgroundTasks.some((task) => task.id === id)
          )
      : undefined
    if (owner) owner.runtime.stopBackgroundTask(id)
    else this.backgroundTasks.stop(id)
    this.publish()
  }

  async setModel(provider: string, id: string): Promise<void> {
    await this.mutate(async () => {
      if (!this.snapshot.models.some((model) => model.provider === provider && model.id === id))
        throw new Error('请选择可用的模型')
      const model = this.models.getModel(provider, id)
      if (!model) throw new Error('模型不存在')
      await this.agent.setModel(model, { persist: true })
      await this.settings.flush()
      await new EliConfigStore(join(this.options.root, 'config.json')).update(({ agent }) => {
        agent.defaultProvider = provider
        agent.defaultModel = id
      })
    })
  }

  async setThinkingLevel(level: AgentThinkingLevel): Promise<void> {
    await this.mutate(async () => {
      if (!this.snapshot.thinkingLevels.includes(level)) throw new Error('当前模型不支持该思考强度')
      this.agent.setThinkingLevel(level, { persist: true })
      await this.settings.flush()
      await new EliConfigStore(join(this.options.root, 'config.json')).update(({ agent }) => {
        agent.defaultThinkingLevel = level
      })
    })
  }

  getSkills(): import('../shared/agent').AgentSkillCommand[] {
    return this.settings.getEnableSkillCommands()
      ? this.loader
          .getSkills()
          .skills.map(({ name, description }) => ({ name: `skill:${name}`, description }))
      : []
  }

  private messageTarget(
    target: AgentMessageTarget,
    role: 'user' | 'assistant'
  ): {
    manager: SessionManager
    entry: import('@earendil-works/pi-coding-agent').SessionMessageEntry
    message: import('../shared/agent').AgentMessage
  } {
    const manager = this.agent.sessionManager
    if (target.sessionId !== manager.getSessionId()) throw new Error('会话已变化，请重新选择消息')
    const projected = manager
      .buildSessionProjection()
      .entries.find(({ sourceEntry }) => sourceEntry.id === target.entryId)
    const entry = projected?.sourceEntry
    const message = projected?.messages.find((message) => message.role === role)
    if (!entry || entry.type !== 'message' || !message) throw new Error('该消息已不在当前会话中')
    return { manager, entry, message }
  }

  async forkMessage(target: AgentMessageTarget): Promise<string> {
    return this.mutate(async () => {
      const { manager, entry } = this.messageTarget(target, 'assistant')
      const path = manager.getSessionFile()
      if (!path) throw new Error('会话尚未保存')
      const copy = SessionManager.open(path, manager.getSessionDir())
      const newPath = copy.createBranchedSession(entry.id)
      if (!newPath) throw new Error('无法创建独立会话文件')
      copy.appendSessionInfo(`${this.state().summary?.title ?? '新对话'} · 分叉`)
      return newPath
    })
  }

  async editMessage(target: AgentMessageTarget, text: string): Promise<void> {
    await this.mutate(async () => {
      const { manager, entry, message } = this.messageTarget(target, 'user')
      const previousLeaf = manager.getLeafId()
      const model = this.agent.model
      const selection = model
        ? { provider: model.provider, modelId: model.id, thinkingLevel: this.agent.thinkingLevel }
        : undefined
      this.unsubscribe?.()
      await this.closeAgent('reload')
      try {
        if (entry.parentId) manager.branch(entry.parentId)
        else manager.resetLeaf()
        manager.appendCustomEntry('eli.message_edit')
        await this.openAgent(manager, selection)
        this.snapshot.tools = {}
        this.sync()
      } catch (error) {
        if (previousLeaf) manager.branch(previousLeaf)
        else manager.resetLeaf()
        manager.appendCustomEntry('eli.message_edit_rollback')
        await this.openAgent(manager, selection)
        throw error
      }
      const images =
        message.role === 'user' && Array.isArray(message.content)
          ? message.content.filter((part) => part.type === 'image')
          : []
      this.startRun(() => this.agent.prompt(text, { images }), text)
    })
  }

  private onEvent(event: AgentSessionEvent): void {
    switch (event.type) {
      case 'agent_start':
        this.snapshot.running = true
        if (!this.operation && this.snapshot.response.phase === 'idle') {
          this.abortRequested = false
          this.interactions.begin()
          this.snapshot.response.id++
          this.snapshot.response.messageIndex = this.snapshot.messages.length
        }
        if (!this.abortRequested) this.snapshot.response.phase = 'waiting'
        break
      case 'turn_start':
        if (!this.abortRequested) this.snapshot.response.phase = 'waiting'
        break
      case 'message_start':
        this.activeMessage = this.snapshot.messages.length
        this.snapshot.messages.push(event.message)
        this.snapshot.messageEntryIds.push(null)
        this.snapshot.activeThinking = null
        break
      case 'message_update': {
        const update = event.assistantMessageEvent
        if (this.activeMessage >= 0) this.snapshot.messages[this.activeMessage] = event.message
        if (!this.abortRequested) {
          if (update.type === 'thinking_start' || update.type === 'thinking_delta') {
            this.snapshot.response.phase = 'thinking'
            this.snapshot.activeThinking = {
              messageIndex: this.activeMessage,
              contentIndex: update.contentIndex
            }
          } else if (update.type === 'text_start' || update.type === 'text_delta') {
            this.snapshot.response.phase = 'text'
            this.snapshot.activeThinking = null
          } else if (update.type === 'toolcall_start' || update.type === 'toolcall_delta') {
            this.snapshot.response.phase = 'tool-call'
            this.snapshot.activeThinking = null
            const block =
              event.message.role === 'assistant'
                ? event.message.content[update.contentIndex]
                : undefined
            if (block?.type === 'toolCall')
              this.snapshot.response.toolCallDrafts[block.id] =
                update.type === 'toolcall_delta'
                  ? (this.snapshot.response.toolCallDrafts[block.id] ?? '') + update.delta
                  : ''
          } else if (update.type === 'thinking_end') this.snapshot.activeThinking = null
          else if (update.type === 'toolcall_end')
            delete this.snapshot.response.toolCallDrafts[update.toolCall.id]
        }
        break
      }
      case 'message_end':
        if (this.activeMessage >= 0) this.snapshot.messages[this.activeMessage] = event.message
        this.activeMessage = -1
        this.snapshot.activeThinking = null
        if (event.message.role === 'assistant') this.snapshot.response.toolCallDrafts = {}
        this.snapshot.contextUsage = this.agent.getContextUsage() ?? null
        break
      case 'tool_execution_start':
      case 'tool_execution_update':
      case 'tool_execution_end':
        this.snapshot.tools[event.toolCallId] = event
        if (event.type === 'tool_execution_end') this.activeTools.delete(event.toolCallId)
        else this.activeTools.add(event.toolCallId)
        if (!this.abortRequested && this.activeMessage < 0)
          this.snapshot.response.phase = this.activeTools.size ? 'tool-running' : 'waiting'
        break
      case 'compaction_start':
        this.snapshot.activity = '正在整理上下文'
        this.snapshot.contextUsage = null
        this.snapshot.activeThinking = null
        break
      case 'compaction_end':
        this.snapshot.contextUsage = this.agent.getContextUsage() ?? null
        if (event.reason !== 'manual') this.snapshot.activity = ''
        break
      case 'auto_retry_start':
        this.snapshot.response.phase = 'waiting'
        this.snapshot.activeThinking = null
        this.snapshot.response.toolCallDrafts = {}
        break
      case 'auto_retry_end':
        if (event.finalError) this.snapshot.error = event.finalError
        break
      case 'agent_settled':
        if (!this.operation && !this.locked) {
          this.interactions.cancel()
          this.sync()
          this.snapshot.running = false
          this.snapshot.response.phase = 'idle'
          this.snapshot.activeThinking = null
          this.snapshot.response.toolCallDrafts = {}
          this.publish(true)
        }
        break
    }
    this.publish(event.type === 'message_end')
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    await this.abort()
    if (!this.collaboration) await this.team?.close()
    await this.backgroundTasks?.close()
    this.unsubscribe?.()
    await this.closeAgent('quit')
    await this.settings?.flush()
  }

  private async closeAgent(reason: 'reload' | 'quit'): Promise<void> {
    if (!this.agent) return
    try {
      // AgentSession.dispose() 只释放会话本身；MCP 连接等异步资源由此生命周期事件关闭。
      await this.agent.extensionRunner.emit({ type: 'session_shutdown', reason })
    } finally {
      this.agent.dispose()
    }
  }
}
