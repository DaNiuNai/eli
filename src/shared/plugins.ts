import { builtinBundle } from './plugin-bundles'
export const pluginProfiles = ['control', 'session-host', 'session', 'desktop', 'client'] as const
export type PluginProfile = (typeof pluginProfiles)[number]

export interface PluginEntry {
  id: string
  name: string
  disabled?: boolean
  config?: Record<string, unknown>
}

export interface PluginPatch {
  id: string
  name?: string
  disabled?: boolean
  config?: Record<string, unknown>
}

export interface PluginConfiguration {
  version: 1
  profiles: Partial<Record<PluginProfile, PluginPatch[]>>
  packages?: ManagedPackage[]
}

export interface ManagedPackage {
  modules?: Record<string, string>
  name: string
  version: string
  description: string
  source: string
  generation: string
  enabled: boolean
  target: PluginProfile
  entries: Partial<Record<PluginProfile, PluginPatch[]>>
}

export interface InventoryEntry extends PluginEntry {
  state?: PluginStatus['state']
  profile: PluginProfile
  owner?: string
  protected: boolean
}

export interface PluginInventory {
  startupError?: string
  entries: InventoryEntry[]
  packages: ManagedPackage[]
}
export type RuntimePluginInventory = Partial<Record<PluginProfile, PluginStatus[]>>

export type PluginChange =
  | {
      kind: 'configure'
      profile: PluginProfile
      id: string
      config: Record<string, unknown> | null
    }
  | { kind: 'toggle'; profile: PluginProfile; id: string; enabled: boolean }
  | { kind: 'install'; source: string; profile: PluginProfile }
  | { kind: 'update'; name: string; version: string }
  | { kind: 'enable'; name: string; enabled: boolean }
  | { kind: 'remove'; name: string }

export interface PluginChangeResult {
  inventory: PluginInventory
  notice: string
}

export interface PluginStatus extends PluginEntry {
  state: 'pending' | 'active' | 'disabled' | 'failed' | 'disposed'
  error?: string
}

export const defaultClientPlugins = builtinBundle('client')

export interface PluginsApi {
  projection(sessionKey: string, key: string): Promise<unknown>
  client(): Promise<PluginEntry[]>
  inventory(): Promise<PluginInventory>
  versions(name: string): Promise<string[]>
  change(change: PluginChange): Promise<PluginChangeResult>
  chooseDirectory(): Promise<string | null>
  onClientReload(handler: () => Promise<void>): () => void
}
export const pluginsChannels = {
  projection: 'plugins:projection',
  client: 'plugins:client',
  inventory: 'plugins:inventory',
  versions: 'plugins:versions',
  change: 'plugins:change',
  choose: 'plugins:choose',
  reload: 'plugins:reload',
  applied: 'plugins:applied'
} as const

/** 与 dsh 一样按 id 覆盖整份 config；新条目必须明确指定模块。 */
export function composePlugins(
  base: readonly PluginEntry[],
  patches: readonly PluginPatch[]
): PluginEntry[] {
  const entries = new Map(base.map((entry) => [entry.id, { ...entry }]))
  if (entries.size !== base.length) throw new Error('默认插件 ID 重复')
  const seen = new Set<string>()
  for (const patch of patches) {
    if (seen.has(patch.id)) throw new Error(`重复的插件配置：${patch.id}`)
    seen.add(patch.id)
    const previous = entries.get(patch.id)
    const name = patch.name ?? previous?.name
    if (!name) throw new Error(`新插件 ${patch.id} 缺少模块名称`)
    entries.set(patch.id, { ...previous, ...patch, name })
  }
  return [...entries.values()]
}

export function parsePluginConfiguration(value: unknown): PluginConfiguration {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('插件配置必须是对象')
  const input = value as Record<string, unknown>
  if (input.version !== undefined && input.version !== 1) throw new Error('不支持的插件配置版本')
  const profiles = input.profiles ?? {}
  const result: PluginConfiguration = { version: 1, profiles: parseProfiles(profiles) }
  if (input.packages !== undefined) {
    if (!Array.isArray(input.packages)) throw new Error('无效的插件包记录')
    const names = new Set<string>()
    result.packages = input.packages.map((pkg) => {
      if (
        !pkg ||
        typeof pkg.name !== 'string' ||
        names.has(pkg.name) ||
        typeof pkg.version !== 'string' ||
        typeof pkg.description !== 'string' ||
        typeof pkg.source !== 'string' ||
        typeof pkg.enabled !== 'boolean' ||
        !pluginProfiles.includes(pkg.target) ||
        typeof pkg.generation !== 'string' ||
        !/^[0-9a-f-]{36}$/.test(pkg.generation)
      )
        throw new Error('无效的插件包记录')
      names.add(pkg.name)
      return { ...pkg, entries: parseProfiles(pkg.entries) }
    })
  }
  return result
}

function parseProfiles(profiles: unknown): PluginConfiguration['profiles'] {
  if (!profiles || typeof profiles !== 'object' || Array.isArray(profiles))
    throw new Error('插件 profiles 必须是对象')
  const result: PluginConfiguration['profiles'] = {}
  for (const [profile, rows] of Object.entries(profiles)) {
    if (!['control', 'session-host', 'session', 'desktop', 'client'].includes(profile))
      throw new Error(`未知插件配置：${profile}`)
    if (!Array.isArray(rows)) throw new Error(`${profile} 插件必须是数组`)
    const patches: PluginPatch[] = []
    for (const row of rows) {
      if (
        !row ||
        typeof row !== 'object' ||
        Array.isArray(row) ||
        typeof row.id !== 'string' ||
        !/^[a-z][a-z0-9._-]*$/.test(row.id) ||
        (row.name !== undefined && (typeof row.name !== 'string' || !row.name.trim())) ||
        (row.disabled !== undefined && typeof row.disabled !== 'boolean') ||
        (row.config !== undefined &&
          (!row.config || typeof row.config !== 'object' || Array.isArray(row.config)))
      ) {
        throw new Error(`${profile} 插件条目格式无效`)
      }
      patches.push({
        id: row.id,
        ...(row.name === undefined ? {} : { name: row.name }),
        ...(row.disabled === undefined ? {} : { disabled: row.disabled }),
        ...(row.config === undefined ? {} : { config: row.config })
      })
    }
    result[profile as PluginProfile] = patches
  }
  return result
}
