import type { RuntimeInit, RuntimeRequest, RuntimeMessage } from '../shared/runtime'
import { mainAgentId, runtimeProtocolVersion } from '../shared/runtime'
import { isToolApprovalMode } from '../shared/tool-approval'
import { RuntimeCoordinator } from './coordinator'
import { ProvidersService } from './providers'
import { AgentLibraryService } from './library'
import { AgentSettingsService } from './settings-service'
import { AgentAuthService } from './auth'
import { runtimePaths } from './paths'
import { closeNetwork } from './network'
import { SkillsService } from './skills'
import { McpService } from './mcp'

export class RuntimeHost {
  private coordinator?: RuntimeCoordinator
  private library?: AgentLibraryService
  private settings?: AgentSettingsService
  private skills?: SkillsService
  private mcp?: McpService
  private auth?: AgentAuthService
  private providers?: ProvidersService
  private initialized = false
  private closing = false
  private init?: Promise<void>
  private active = new Set<Promise<unknown>>()
  private timer?: ReturnType<typeof setTimeout>
  private libraryChanged = false
  private closePromise?: Promise<void>

  constructor(private readonly emit: (message: RuntimeMessage) => void) {}

  private publish = (libraryChanged = false): void => {
    this.libraryChanged ||= libraryChanged
    if (this.timer || this.closing) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      if (this.coordinator && !this.closing)
        this.emit({
          version: runtimeProtocolVersion,
          kind: 'session',
          agentId: mainAgentId,
          state: this.coordinator.state(),
          libraryChanged: this.libraryChanged
        })
      this.libraryChanged = false
    }, 24)
  }

  private async initialize(options: RuntimeInit): Promise<void> {
    if (this.init || this.initialized) throw new Error('Runtime 已初始化')
    if (!options || typeof options.root !== 'string' || typeof options.cwd !== 'string')
      throw new Error('无效的 Runtime 配置')
    this.init = (async () => {
      if (options.kind === 'session') {
        if (
          typeof options.sessionKey !== 'string' ||
          !isToolApprovalMode(options.approvalMode) ||
          !options.terminal?.path
        )
          throw new Error('无效的会话配置')
        this.coordinator = new RuntimeCoordinator(options, this.publish)
        await this.coordinator.initialize()
      } else if (options.kind === 'control') {
        this.library = new AgentLibraryService(runtimePaths(options.root).sessions)
        this.settings = new AgentSettingsService(options.root)
        this.skills = new SkillsService(options.root)
        this.mcp = new McpService(options.root, options.cwd, (snapshot) => {
          this.emit({ version: runtimeProtocolVersion, kind: 'mcp_auth', snapshot })
        })
        this.providers = new ProvidersService(options.root, () => {
          this.emit({ version: runtimeProtocolVersion, kind: 'providers_changed' })
        })
        this.auth = new AgentAuthService(
          options.root,
          (snapshot) => this.emit({ version: runtimeProtocolVersion, kind: 'auth', snapshot }),
          options.firstLaunch,
          this.providers
        )
      } else throw new Error('无效的 Runtime 类型')
      this.initialized = true
    })()
    await this.init
  }

  async handle(value: unknown): Promise<unknown> {
    if (!value || typeof value !== 'object') throw new Error('无效的 Runtime 请求')
    const request = value as RuntimeRequest
    if (
      request.version !== runtimeProtocolVersion ||
      request.kind !== 'request' ||
      typeof request.id !== 'string' ||
      request.agentId !== mainAgentId ||
      !Array.isArray(request.args)
    )
      throw new Error('Runtime 协议不匹配')
    if (request.method === 'shutdown') {
      await this.close()
      return
    }
    if (this.closing) throw new Error('Runtime 已关闭')
    const operation = this.dispatch(request)
    this.active.add(operation)
    try {
      return await operation
    } finally {
      this.active.delete(operation)
    }
  }

  private async dispatch(request: RuntimeRequest): Promise<unknown> {
    if (request.method === 'initialize') {
      await this.initialize(request.args[0])
      return this.coordinator?.state() ?? null
    }
    if (!this.initialized) throw new Error('Runtime 尚未初始化')
    const session = this.coordinator
    if (session) {
      switch (request.method) {
        case 'prompt':
          session.prompt(...request.args)
          break
        case 'compact':
          session.compact(...request.args)
          break
        case 'abort':
          await session.abort()
          break
        case 'setModel':
          await session.setModel(...request.args)
          break
        case 'setThinkingLevel':
          await session.setThinkingLevel(...request.args)
          break
        case 'editMessage':
          await session.editMessage(...request.args)
          break
        case 'forkMessage':
          return session.forkMessage(...request.args)
        case 'getSkills':
          return session.getSkills()
        case 'configure':
          if (!isToolApprovalMode(request.args[0])) throw new Error('无效的工具审批挡位')
          session.interactions.setMode(request.args[0])
          return
        case 'approve':
          session.interactions.respondApproval(...request.args)
          return
        case 'answer':
          session.interactions.respondQuestion(...request.args)
          return
        default:
          throw new Error('此 Runtime 不支持该操作')
      }
      return session.state()
    }
    switch (request.method) {
      case 'getProviders':
        return this.providers!.get()
      case 'changeProvider':
        return this.providers!.change(...request.args)
      case 'getLibrary':
        return this.library!.load(...request.args)
      case 'findSession':
        return this.library!.findSession(...request.args)
      case 'hasWorkspace':
        return this.library!.hasWorkspace(...request.args)
      case 'getSettings':
        return this.settings!.get()
      case 'getUserSkills':
        return this.skills!.get()
      case 'getMcpServers':
        return this.mcp!.get()
      case 'changeMcpServer':
        return this.mcp!.change(...request.args)
      case 'testMcpServer':
        return this.mcp!.test(...request.args)
      case 'getMcpAuth':
        return this.mcp!.getAuth()
      case 'startMcpAuth':
        return this.mcp!.startAuth(...request.args)
      case 'signOutMcpAuth':
        return this.mcp!.signOut(...request.args)
      case 'cancelMcpAuth':
        return this.mcp!.cancelAuth(...request.args)
      case 'respondMcpAuth':
        return this.mcp!.respondAuth(...request.args)
      case 'validateMcpAuthLink':
        return this.mcp!.validateAuthLink(...request.args)
      case 'getMcpWebsite':
        return this.mcp!.website(...request.args)
      case 'setSkillEnabled':
        return this.skills!.setEnabled(...request.args)
      case 'saveSettings':
        return this.settings!.save(...request.args)
      case 'getAuth':
        return this.auth!.get()
      case 'login':
        return this.auth!.login(...request.args)
      case 'respondLogin':
        return this.auth!.respond(...request.args)
      case 'cancelLogin':
        return this.auth!.cancel()
      case 'validateAuthLink':
        return this.auth!.validateLink(...request.args)
      default:
        throw new Error('此 Runtime 不支持该操作')
    }
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise
    this.closing = true
    clearTimeout(this.timer)
    this.closePromise = (async () => {
      await this.init?.catch(() => {})
      await Promise.allSettled([this.coordinator?.abort(), this.auth?.cancel(), this.mcp?.close()])
      await Promise.allSettled([...this.active])
      await Promise.allSettled([this.coordinator?.dispose(), this.auth?.dispose()])
      await closeNetwork()
    })()
    return this.closePromise
  }
}
