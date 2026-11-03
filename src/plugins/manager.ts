import { join } from 'node:path'
import { readdir } from 'node:fs/promises'
import semver from 'semver'
import { JsonStore } from '../config/store'
import { builtinBundle } from '../shared/plugin-bundles'
import {
  pluginProfiles,
  parsePluginConfiguration,
  type PluginProfile,
  type PluginEntry,
  type PluginChange,
  type PluginInventory,
  type PluginChangeResult,
  type PluginConfiguration,
  type ManagedPackage
} from '../shared/plugins'
import { composedProfile } from './config'
import { PluginPackages } from './packages'

const base: Record<PluginProfile, PluginEntry[]> = {
  control: [...builtinBundle('runtime'), ...builtinBundle('control')],
  'session-host': [...builtinBundle('runtime'), ...builtinBundle('session-host')],
  session: [
    ...builtinBundle('engine'),
    ...builtinBundle('features'),
    { id: 'desktop-observer', name: 'eli.desktop-observer' }
  ],
  desktop: builtinBundle('desktop'),
  client: builtinBundle('client')
}
// Keep the management path and services required by the session coordinator reachable.
const optional: Record<PluginProfile, readonly string[]> = {
  desktop: ['updates', 'terminal'],
  control: ['skills', 'mcp', 'auth'],
  'session-host': [],
  session: [
    'instructions',
    'file-tools',
    'terminal',
    'questions',
    'subagents',
    'mcp',
    'discovery',
    'cache-warming',
    'image-offload'
  ],
  client: [
    'ui-tasks',
    'ui-usage',
    'ui-skills',
    'ui-mcp',
    'ui-about',
    'ui-general-settings',
    'ui-model-settings'
  ]
}

function inventory(config: PluginConfiguration): PluginInventory {
  return {
    packages: config.packages ?? [],
    entries: pluginProfiles.flatMap((profile) => {
      const owners = new Map<string, string>()
      for (const pkg of config.packages ?? []) {
        for (const row of pkg.entries[profile] ?? []) if (pkg.enabled) owners.set(row.id, pkg.name)
      }
      // Some rows (workspace extensions and Code Mode services) only exist in a concrete session.
      const dynamic = (config.profiles[profile] ?? []).filter(
        (row) =>
          !row.name &&
          !base[profile].some((it) => it.id === row.id) &&
          !(config.packages ?? []).some((pkg) =>
            pkg.entries[profile]?.some((it) => it.id === row.id)
          )
      )
      const entries = composedProfile(config, profile, [
        ...base[profile],
        ...dynamic.map((row) => ({ id: row.id, name: row.id }))
      ])
      return entries.map((row) => ({
        ...row,
        profile,
        owner: owners.get(row.id),
        protected:
          base[profile].some((it) => it.id === row.id) && !optional[profile].includes(row.id)
      }))
    })
  }
}

export class PluginManager {
  private readonly store: JsonStore<PluginConfiguration>
  private busy = false
  private readonly lifetime = new AbortController()
  constructor(
    root: string,
    private readonly packages: PluginPackages,
    private readonly apply: (profiles: PluginProfile[], rebuild: boolean) => Promise<string>
  ) {
    this.store = new JsonStore(join(root, 'plugins.json'), parsePluginConfiguration)
  }

  async list(): Promise<PluginInventory> {
    return inventory(await this.store.read())
  }
  async versions(name: string): Promise<string[]> {
    if (!(await this.list()).packages.some((pkg) => pkg.name === name && registrySource(pkg)))
      throw new Error('只能查询已安装 npm 插件的版本')
    return this.packages.versions(name)
  }
  close(): void {
    this.lifetime.abort()
  }

  /** Old releases stay available to sessions finishing background work until the next launch. */
  async collect(): Promise<void> {
    const keep = new Set((await this.list()).packages.map((pkg) => pkg.generation))
    for (const dir of await readdir(this.packages.directory, { withFileTypes: true }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return []
        throw error
      }
    )) {
      if (
        dir.isDirectory() &&
        /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/.test(dir.name) &&
        !keep.has(dir.name)
      )
        await this.packages.discard(dir.name)
    }
  }

  async change(action: PluginChange): Promise<PluginChangeResult> {
    if (this.busy) throw new Error('另一个插件操作仍在运行')
    if (!action || typeof action !== 'object') throw new Error('无效的插件操作')
    this.busy = true
    try {
      return await this.applyChange(action)
    } finally {
      this.busy = false
    }
  }

  private async applyChange(action: PluginChange): Promise<PluginChangeResult> {
    const before = await this.store.read()
    const next = structuredClone(before)
    const packages = (next.packages ??= [])
    const profiles = new Set<PluginProfile>()
    const items = inventory(before)
    let staged: ManagedPackage | undefined
    let saved = false
    const save = async (
      expected: PluginConfiguration,
      value: PluginConfiguration
    ): Promise<void> => {
      await this.store.update((current) => {
        if (JSON.stringify(current) !== JSON.stringify(expected))
          throw new Error('插件配置已改变，请刷新后重试')
        current.profiles = value.profiles
        if (value.packages) current.packages = value.packages
        else delete current.packages
      })
    }
    try {
      if (action.kind === 'toggle' || action.kind === 'configure') {
        const row = items.entries.find((it) => it.profile === action.profile && it.id === action.id)
        if (
          !row ||
          row.protected ||
          (action.kind === 'toggle' && typeof action.enabled !== 'boolean')
        )
          throw new Error('此插件由系统管理')
        const patches = (next.profiles[action.profile] ??= [])
        const patch = patches.find((it) => it.id === action.id) ?? { id: action.id }
        if (action.kind === 'toggle') patch.disabled = !action.enabled
        else if (row.name === 'eli.dsh-tree') throw new Error('组合包内部的配置由其 patch 管理')
        else if (action.config === null) delete patch.config
        else {
          if (!action.config || typeof action.config !== 'object' || Array.isArray(action.config))
            throw new Error('插件配置必须是 JSON 对象')
          patch.config = action.config
        }
        if (!patches.includes(patch)) patches.push(patch)
        if (Object.keys(patch).length === 1) patches.splice(patches.indexOf(patch), 1)
        profiles.add(action.profile)
      } else {
        const existing =
          'name' in action ? packages.find((it) => it.name === action.name) : undefined
        if (action.kind !== 'install' && !existing) throw new Error('插件包未安装')
        if (action.kind === 'install' || action.kind === 'update') {
          if (
            action.kind === 'install' &&
            (!pluginProfiles.includes(action.profile) || typeof action.source !== 'string')
          )
            throw new Error('无效的安装请求')
          if (
            action.kind === 'update' &&
            (!registrySource(existing!) || !semver.valid(action.version))
          )
            throw new Error('无效的目标版本')
          staged = await this.packages.stage(
            action.kind === 'install' ? action.source : action.name + '@' + action.version,
            action.kind === 'install' ? action.profile : existing!.target,
            this.lifetime.signal
          )
          if (
            existing &&
            (staged.name !== existing.name ||
              action.kind !== 'update' ||
              staged.version !== action.version)
          )
            throw new Error('下载的插件版本不匹配')
          if (!existing && packages.some((it) => it.name === staged!.name))
            throw new Error('该插件包已经安装')
          staged.enabled = existing?.enabled ?? true
          for (const profile of pluginProfiles)
            for (const row of staged.entries[profile] ?? []) {
              if (
                row.name &&
                (base[profile].some((it) => it.id === row.id) ||
                  packages.some(
                    (pkg) =>
                      pkg !== existing && pkg.entries[profile]?.some((it) => it.id === row.id)
                  ) ||
                  (!existing?.entries[profile]?.some((it) => it.id === row.id) &&
                    next.profiles[profile]?.some((it) => it.id === row.id)))
              )
                throw new Error('插件条目 ID 冲突：' + row.id)
              if (
                !row.name &&
                items.entries.some(
                  (it) => it.profile === profile && it.id === row.id && it.protected
                )
              )
                throw new Error('组合包尝试覆盖系统服务：' + row.id)
            }
          if (existing) packages.splice(packages.indexOf(existing), 1, staged)
          else packages.push(staged)
        } else if (action.kind === 'remove') packages.splice(packages.indexOf(existing!), 1)
        else if (action.kind === 'enable' && typeof action.enabled === 'boolean')
          existing!.enabled = action.enabled
        else throw new Error('无效的插件操作')
        for (const profile of pluginProfiles) {
          if (existing?.entries[profile] || staged?.entries[profile]) profiles.add(profile)
          if (action.kind === 'remove' || action.kind === 'update') {
            const removed = new Set(
              existing?.entries[profile]
                ?.filter(
                  (it) => it.name && !staged?.entries[profile]?.some((row) => row.id === it.id)
                )
                .map((it) => it.id)
            )
            if (next.profiles[profile])
              next.profiles[profile] = next.profiles[profile].filter(
                (it) => it.name || !removed.has(it.id)
              )
          }
        }
      }
      const result = inventory(next)
      await save(before, next)
      saved = true
      const rebuild =
        (action.kind === 'toggle' || action.kind === 'configure') &&
        ['terminal', 'subagents', 'discovery', 'mcp'].includes(action.id)
      const notice = await this.apply([...profiles], rebuild)
      return { inventory: result, notice }
    } catch (error) {
      if (saved) {
        await save(next, before)
        try {
          await this.apply([...profiles], true)
        } catch (rollback) {
          throw new AggregateError(
            [error, rollback],
            '已恢复插件配置；请重启以重新载入：' + String(error),
            { cause: rollback }
          )
        }
      }
      if (staged) await this.packages.discard(staged.generation)
      throw error
    }
  }
}

function registrySource(pkg: ManagedPackage): boolean {
  return pkg.source === pkg.name || pkg.source.startsWith(pkg.name + '@')
}
