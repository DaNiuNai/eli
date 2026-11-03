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

  async start(entries: readonly PluginEntry[], resolve: PluginResolver): Promise<void> {
    if (this.started || this.disposed) throw new Error('插件应用已启动或关闭')
    this.started = true
    this.entries = structuredClone([...entries])
    if (new Set(entries.map(({ id }) => id)).size !== entries.length)
      throw new Error('插件 ID 重复')
    try {
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
          } catch (cause) {
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
    } catch (error) {
      await this.dispose()
      throw error
    }
  }

  status(): PluginStatus[] {
    return this.entries.map((entry) => {
      if (entry.disabled) return { ...entry, state: 'disabled' }
      const error = this.failures.get(entry.id)
      if (error) return { ...entry, state: 'failed', error }
      if (this.disposed) return { ...entry, state: 'disposed' }
      return { ...entry, state: this.fibers.has(entry.id) ? 'active' : 'pending' }
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
