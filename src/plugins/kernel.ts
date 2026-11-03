import { Context, Inject, type Fiber, type Plugin } from '@deepseek-ai/cordis'
import type { PluginEntry, PluginStatus } from '../shared/plugins'

export type PluginResolver = (name: string) => Plugin | Promise<Plugin>

/** Cordis 拥有服务依赖与清理；载体只负责配置、模块解析及启动失败报告。 */
export class PluginApplication {
  readonly ctx = new Context()
  private readonly fibers = new Map<string, Fiber>()
  private readonly failures = new Map<string, string>()
  private entries: PluginEntry[] = []
  private started = false
  private disposed = false
  private closing?: Promise<void>
  private resolver?: PluginResolver
  private source?: () => Promise<PluginEntry[]>

  async startProfile(source: () => Promise<PluginEntry[]>, resolve: PluginResolver): Promise<void> {
    this.source = source
    await this.start(await source(), resolve)
  }

  async refresh(): Promise<void> {
    if (!this.source) throw new Error('插件配置来源未注册')
    await this.reload(await this.source())
  }

  async start(entries: readonly PluginEntry[], resolve: PluginResolver): Promise<void> {
    if (this.started || this.disposed) throw new Error('插件应用已启动或关闭')
    this.started = true
    this.resolver = resolve
    this.entries = structuredClone([...entries])
    if (new Set(entries.map(({ id }) => id)).size !== entries.length)
      throw new Error('插件 ID 重复')
    try {
      await this.mount(entries, resolve)
    } catch (error) {
      await this.dispose()
      throw error
    }
  }

  private async mount(entries: readonly PluginEntry[], resolve: PluginResolver): Promise<void> {
    const pending = new Map<string, { entry: PluginEntry; plugin: Plugin }>()
    for (const entry of entries) {
      if (!entry.disabled) pending.set(entry.id, { entry, plugin: await resolve(entry.name) })
    }
    while (pending.size) {
      let progress = false
      for (const [id, { entry, plugin }] of pending) {
        const dependencies = Object.keys(Inject.resolve(plugin.inject))
        if (dependencies.some((key) => this.ctx.get(key) === undefined)) continue
        const fiber = this.ctx.plugin(plugin, entry.config ?? {})
        try {
          await fiber
          this.fibers.set(id, fiber)
          this.failures.delete(id)
        } catch (cause) {
          await fiber.dispose()
          const reason = cause instanceof Error ? cause.message : '模块初始化失败'
          this.failures.set(id, reason)
          throw new Error(`插件 ${id}（${entry.name}）启动失败：${reason}`, { cause })
        }
        pending.delete(id)
        progress = true
      }
      if (!progress) {
        const missing = [...pending.values()].map(({ entry, plugin }) => {
          const names = Object.keys(Inject.resolve(plugin.inject)).filter(
            (key) => this.ctx.get(key) === undefined
          )
          return `${entry.id}: ${names.join(', ')}`
        })
        throw new Error(`插件依赖缺失或循环：${missing.join('；')}`)
      }
    }
  }

  /** 仅卸载发生变化的 fiber；同一棵树上的会话、界面状态和其他插件保持存活。 */
  async reload(
    entries: readonly PluginEntry[],
    resolver: PluginResolver | undefined = this.resolver
  ): Promise<void> {
    if (!this.resolver || !resolver || this.disposed) throw new Error('插件应用尚未就绪')
    const previous = this.entries
    const next = new Map(entries.map((row) => [row.id, row]))
    if (next.size !== entries.length) throw new Error('插件 ID 重复')
    const changed = new Set<string>()
    for (const row of previous) {
      if (JSON.stringify(row) !== JSON.stringify(next.get(row.id))) changed.add(row.id)
      next.delete(row.id)
    }
    for (const id of next.keys()) changed.add(id)
    const unmount = async (): Promise<void> => {
      for (const [id, fiber] of [...this.fibers].reverse()) {
        if (changed.has(id)) {
          await fiber.dispose()
          this.fibers.delete(id)
        }
      }
    }
    try {
      await unmount()
      await this.mount(
        entries.filter((row) => changed.has(row.id)),
        resolver
      )
      for (const [id, fiber] of this.fibers) {
        await fiber.await()
        if (fiber.state !== 2) throw new Error('插件失去必需服务：' + id)
      }
      this.resolver = resolver
      this.entries = structuredClone([...entries])
    } catch (error) {
      await unmount()
      await this.mount(
        previous.filter((row) => changed.has(row.id)),
        this.resolver
      )
      throw error
    }
  }

  status(): PluginStatus[] {
    return this.entries.map((entry) => {
      if (entry.disabled) return { ...entry, state: 'disabled' }
      const error = this.failures.get(entry.id)
      if (error) return { ...entry, state: 'failed', error }
      if (this.disposed) return { ...entry, state: 'disposed' }
      return { ...entry, state: this.fibers.get(entry.id)?.state === 2 ? 'active' : 'pending' }
    })
  }

  dispose(): Promise<void> {
    this.disposed = true
    return (this.closing ??= Promise.resolve().then(async () => {
      await this.ctx.fiber.dispose()
      this.fibers.clear()
    }))
  }
}
