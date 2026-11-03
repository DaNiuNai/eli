import * as React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsPage, SlotEntry, UiSlots } from './contracts'

const emptyEntries: readonly never[] = []

/** 与 dsh 相同的可撤销 UI 贡献：组件、Provider、设置页全部由插件注册。 */
export class UiRegistry {
  readonly react = React
  private slots = new Map<keyof UiSlots, readonly unknown[]>()
  private pages: readonly SettingsPage[] = []
  private listeners = new Set<() => void>()
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  private changed(): void {
    for (const listener of this.listeners) listener()
  }
  read<K extends keyof UiSlots>(slot: K): readonly SlotEntry<K>[] {
    return (this.slots.get(slot) ?? emptyEntries) as readonly SlotEntry<K>[]
  }
  settings = (): readonly SettingsPage[] => this.pages

  register<K extends keyof UiSlots>(
    ctx: Context,
    slot: K,
    component: React.ComponentType<UiSlots[K]>,
    id = String(slot),
    order = 0
  ): void {
    const previous = this.read(slot)
    if (previous.some((entry) => entry.id === id)) throw new Error(`界面贡献已注册：${slot}/${id}`)
    if (previous.length && !['providers', 'settings.general'].includes(String(slot)))
      throw new Error(`界面插槽 ${slot} 已被占用；请先在配置中禁用原插件`)
    const entry: SlotEntry<K> = { id, order, component }
    this.slots.set(
      slot,
      [...previous, entry].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    )
    this.changed()
    ctx.effect(() => () => {
      this.slots.set(
        slot,
        this.read(slot).filter((value) => value !== entry)
      )
      this.changed()
    })
  }

  registerSettings(ctx: Context, page: SettingsPage): void {
    if (this.pages.some(({ id }) => id === page.id)) throw new Error(`设置页已注册：${page.id}`)
    this.pages = [...this.pages, page].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    this.changed()
    ctx.effect(() => () => {
      this.pages = this.pages.filter((value) => value !== page)
      this.changed()
    })
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    ui: UiRegistry
  }
}
