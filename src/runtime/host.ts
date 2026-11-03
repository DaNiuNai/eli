import type { RuntimeInit, RuntimeRequest, RuntimeMessage } from '../shared/runtime'
import { mainAgentId, runtimeProtocolVersion } from '../shared/runtime'
import { PluginApplication } from '../plugins/kernel'
import type { PluginEntry } from '../shared/plugins'
import { pluginProfile, pluginResolver } from '../plugins/config'
import { runtimePlugins, runtimeProfile } from './plugins/profile'

/** Runtime 载体只处理进程协议和插件树；业务操作由插件注册。 */
export class RuntimeHost {
  private application?: PluginApplication
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
      const view = this.application?.ctx.get('sessionView')
      if (view && !this.closing)
        this.emit({
          version: runtimeProtocolVersion,
          kind: 'session',
          agentId: mainAgentId,
          state: view.state(),
          libraryChanged: this.libraryChanged
        })
      this.libraryChanged = false
    }, 24)
  }

  private async initialize(options: RuntimeInit): Promise<void> {
    if (this.init || this.initialized) throw new Error('Runtime 已初始化')
    if (
      !options ||
      typeof options.root !== 'string' ||
      typeof options.cwd !== 'string' ||
      !['control', 'session'].includes(options.kind)
    )
      throw new Error('无效的 Runtime 配置')
    this.init = (async () => {
      const application = new PluginApplication()
      this.application = application
      application.ctx.provide('eliRuntime', { options, emit: this.emit, publish: this.publish })
      const source = (): Promise<PluginEntry[]> =>
        pluginProfile(
          options.root,
          options.kind === 'control' ? 'control' : 'session-host',
          runtimeProfile(options)
        )
      await application.startProfile(source, pluginResolver(options.root, runtimePlugins))
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
      return this.application?.ctx.get('sessionView')?.state() ?? null
    }
    if (!this.initialized || !this.application) throw new Error('Runtime 尚未初始化')
    if (request.method === 'pluginInventory') {
      const view = this.application.ctx.get('sessionView')
      return view
        ? { 'session-host': this.application.status(), session: view.pluginStatus() }
        : { control: this.application.status() }
    }
    if (request.method === 'reloadPlugins') {
      if (request.args[0] === 'session')
        await this.application.ctx.get('sessionView')?.reloadPlugins()
      else await this.application.refresh()
      return
    }
    return this.application.ctx.operations.dispatch(request)
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise
    this.closing = true
    clearTimeout(this.timer)
    this.closePromise = (async () => {
      await this.init?.catch(() => {})
      // 先撤销插件以取消交互、登录与网络等待，再收敛在途请求。
      await this.application?.dispose()
      await Promise.allSettled([...this.active])
    })()
    return this.closePromise
  }
}
