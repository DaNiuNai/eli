import { randomUUID } from 'node:crypto'
import type { AgentMessageTarget, AgentSessionSnapshot, AgentThinkingLevel } from '../shared/agent'
import { emptySessionSnapshot } from '../shared/agent-state'
import type { RuntimeMessage, RuntimeSessionState } from '../shared/runtime'
import type { RuntimeConnection } from '../runtime/connection'
import type { ToolApprovalMode } from '../shared/tool-approval'
import type { TerminalPreference } from '../shared/terminal'
import type { UserQuestionAnswer } from '../shared/user-question'
import { isTaskActive } from '../shared/background-tasks'

type SessionRuntime = Pick<RuntimeConnection, 'call' | 'stop'>

export interface SessionProcessServices {
  start: (
    event: (message: RuntimeMessage) => void,
    failed: (error: Error) => void
  ) => SessionRuntime
  resolveTerminal: (preference: TerminalPreference | null) => Promise<TerminalPreference>
}

/** 主进程仅持有可展示的状态和进程句柄。所有 SDK 操作在 Runtime 内完成。 */
export class SessionProcess {
  readonly key = randomUUID()
  snapshot: AgentSessionSnapshot
  private state: RuntimeSessionState
  private client?: SessionRuntime
  private starting?: Promise<SessionRuntime>
  private stopping?: Promise<void>
  private disposing?: Promise<void>
  private idleTimer?: ReturnType<typeof setTimeout>
  private disposed = false
  private locked = false
  private version = 0
  private appliedVersion = 0
  private providerRefreshPending = false

  constructor(
    cwd: string,
    private readonly root: string,
    private readonly changed: (libraryChanged?: boolean) => void,
    private readonly approvalMode: () => ToolApprovalMode,
    private readonly terminal: () => TerminalPreference | null,
    private readonly services: SessionProcessServices,
    sessionFile?: string
  ) {
    this.snapshot = emptySessionSnapshot(cwd, this.key, sessionFile)
    this.state = { snapshot: this.snapshot, summary: null, persistedFile: sessionFile }
  }

  get summary(): RuntimeSessionState['summary'] {
    return this.state.summary
  }
  get persistedFile(): string | undefined {
    return this.state.persistedFile
  }
  get busy(): boolean {
    return this.locked || this.snapshot.running || this.snapshot.pending
  }
  private get hasRunningTasks(): boolean {
    return this.snapshot.backgroundTasks.some(isTaskActive)
  }

  private apply(state: RuntimeSessionState, libraryChanged = false): void {
    this.state = state
    this.snapshot = state.snapshot
    if (this.locked) this.snapshot.pending = true
    if (state.summary) {
      state.summary.running = this.snapshot.running
      state.summary.pending = this.snapshot.pending
    }
    this.scheduleIdle()
    this.changed(libraryChanged)
  }

  async load(): Promise<void> {
    await this.ensureClient()
  }
  private ensureClient(): Promise<SessionRuntime> {
    if (this.starting) return this.starting
    this.starting = this.start().finally(() => {
      this.starting = undefined
      this.scheduleIdle()
    })
    return this.starting
  }
  private async start(): Promise<SessionRuntime> {
    await this.stopping
    if (this.disposed) throw new Error('会话已关闭')
    if (this.client && (this.version === this.appliedVersion || this.hasRunningTasks))
      return this.client
    if (this.client) await this.stopClient()
    const version = this.version
    this.snapshot.connection = 'connecting'
    this.snapshot.error = null
    this.changed()
    const terminal = await this.services.resolveTerminal(this.terminal())
    if (this.disposed) throw new Error('会话已关闭')
    const client = this.services.start(
      (message) => {
        if (this.client !== client || this.disposed) return
        if (message.kind === 'session') this.apply(message.state, message.libraryChanged)
      },
      (error) => {
        if (this.client === client && !this.disposed) this.fail(error)
      }
    )
    this.client = client
    try {
      const model = this.snapshot.model
      const state = await client.call('initialize', {
        kind: 'session',
        root: this.root,
        cwd: this.snapshot.cwd,
        sessionKey: this.key,
        sessionFile: this.persistedFile,
        terminal,
        approvalMode: this.approvalMode(),
        selection: model
          ? {
              provider: model.provider,
              modelId: model.id,
              thinkingLevel: this.snapshot.session?.thinkingLevel ?? 'medium'
            }
          : undefined
      })
      if (this.disposed) throw new Error('会话已关闭')
      if (!state) throw new Error('Runtime 未返回会话状态')
      this.appliedVersion = version
      this.apply(state)
      return client
    } catch (error) {
      await this.stopClient()
      this.fail(error)
      throw error
    }
  }

  async exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (this.disposed) throw new Error('会话已关闭')
    if (this.busy) throw new Error('请等待当前操作完成')
    this.locked = true
    this.snapshot.pending = true
    clearTimeout(this.idleTimer)
    this.changed()
    try {
      return await action()
    } finally {
      this.locked = false
      this.snapshot.pending = false
      if (this.state.summary) this.state.summary.pending = false
      this.scheduleIdle()
      this.changed()
    }
  }
  async prompt(text: string, prepareText?: () => Promise<string>): Promise<void> {
    await this.exclusive(async () => {
      if (prepareText) text = await prepareText()
      this.apply(await (await this.ensureClient()).call('prompt', text), true)
    })
  }
  async compact(instructions?: string): Promise<void> {
    await this.exclusive(async () =>
      this.apply(await (await this.ensureClient()).call('compact', instructions))
    )
  }
  async abort(): Promise<void> {
    if (this.client) this.apply(await this.client.call('abort'))
  }
  async stopBackgroundTask(id: unknown): Promise<void> {
    if (this.disposed) throw new Error('会话已关闭')
    if (typeof id !== 'string') throw new Error('无效的后台任务 ID')
    // 任务可能刚结束；此时不能因设置失效而重启正在回复的 Runtime。
    const client = this.client ?? (await this.ensureClient())
    const state = await client.call('stopBackgroundTask', id)
    if (this.client === client && !this.disposed) this.apply(state)
  }
  async setModel(provider: string, id: string): Promise<void> {
    await this.exclusive(async () =>
      this.apply(await (await this.ensureClient()).call('setModel', provider, id))
    )
  }
  async setThinkingLevel(level: AgentThinkingLevel): Promise<void> {
    await this.exclusive(async () =>
      this.apply(await (await this.ensureClient()).call('setThinkingLevel', level))
    )
  }
  async editMessage(target: unknown, text: string): Promise<void> {
    await this.exclusive(async () => {
      this.messageTarget(target)
      this.apply(
        await (await this.ensureClient()).call('editMessage', target as AgentMessageTarget, text),
        true
      )
    })
  }
  async forkMessage(target: unknown): Promise<string> {
    this.messageTarget(target)
    return (await this.ensureClient()).call('forkMessage', target as AgentMessageTarget)
  }
  async getSkills(): Promise<import('../shared/agent').AgentSkillCommand[]> {
    if (this.busy && this.client) return this.client.call('getSkills')
    return this.exclusive(async () => (await this.ensureClient()).call('getSkills'))
  }
  messageTarget(value: unknown): void {
    if (!value || typeof value !== 'object') throw new Error('无效的消息位置')
    const target = value as Record<string, unknown>
    if (
      typeof target.entryId !== 'string' ||
      target.entryId.length > 256 ||
      target.sessionId !== this.snapshot.session?.sessionId ||
      !this.snapshot.messageEntryIds.includes(target.entryId)
    )
      throw new Error('会话已变化，请重新选择消息')
  }
  async respondToToolApproval(id: unknown, approved: unknown): Promise<void> {
    if (!this.client || typeof id !== 'string' || typeof approved !== 'boolean')
      throw new Error('无效的工具审批答复')
    await this.client.call('approve', id, approved)
  }
  async respondToUserQuestion(id: unknown, answers: unknown): Promise<void> {
    if (!this.client || typeof id !== 'string' || !Array.isArray(answers))
      throw new Error('无效的用户答复')
    await this.client.call('answer', id, answers as UserQuestionAnswer[])
  }
  refreshApprovalMode(): void {
    const client = this.client
    if (!client || this.disposed) return
    void (async () => {
      // 偏好更新也会在进程启动期间发生；只向已初始化且仍属于本会话的进程发送。
      await this.starting
      if (this.client === client && !this.disposed)
        await client.call('configure', this.approvalMode())
    })().catch((error: unknown) => {
      if (this.client === client && !this.disposed) this.fail(error)
    })
  }
  invalidateSettings(): void {
    this.version++
  }
  async refreshProviders(): Promise<void> {
    this.invalidateSettings()
    if (this.busy || this.starting || this.hasRunningTasks) {
      this.providerRefreshPending = true
      return
    }
    this.providerRefreshPending = false
    await this.exclusive(async () => {
      await this.ensureClient()
    })
  }
  private fail(error: unknown): void {
    this.snapshot.connection = 'error'
    this.snapshot.running = false
    this.snapshot.pending = false
    this.snapshot.response.phase = 'idle'
    this.snapshot.response.toolCallDrafts = {}
    this.snapshot.activeThinking = null
    this.snapshot.toolApprovals = []
    this.snapshot.autoApproval = { reviewing: 0, paused: false, lastDenied: null }
    this.snapshot.userQuestions = []
    this.snapshot.backgroundTasks = this.snapshot.backgroundTasks.map((task) =>
      isTaskActive(task) ? { ...task, status: 'interrupted', finishedAt: Date.now() } : task
    )
    this.snapshot.error = error instanceof Error ? error.message : String(error)
    if (this.state.summary)
      Object.assign(this.state.summary, {
        running: false,
        pending: false,
        approvalCount: 0,
        questionCount: 0,
        backgroundTaskCount: 0
      })
    void this.stopClient()
    this.changed()
  }
  private scheduleIdle(): void {
    clearTimeout(this.idleTimer)
    if (this.busy || this.hasRunningTasks || !this.client || this.disposed) return
    if (this.providerRefreshPending && !this.starting) {
      this.providerRefreshPending = false
      void this.refreshProviders().catch((error: unknown) => this.fail(error))
      return
    }
    this.idleTimer = setTimeout(
      () => {
        if (!this.busy && !this.hasRunningTasks) void this.stopClient()
      },
      5 * 60 * 1000
    )
  }
  stopClient(): Promise<void> {
    if (this.stopping) return this.stopping
    clearTimeout(this.idleTimer)
    const client = this.client
    this.client = undefined
    this.stopping = (async () => {
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
    this.disposing = (async () => {
      // 立即通知已经启动的子进程退出，不能先等待 initialize 的最长超时。
      await Promise.allSettled([this.stopClient(), this.starting])
      await this.stopClient()
    })()
    return this.disposing
  }
}
