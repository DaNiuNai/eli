import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve as resolveModule } from 'import-meta-resolve'
import type { Plugin } from '@deepseek-ai/cordis'
import { JsonStore } from '../config/store'
import {
  composePlugins,
  parsePluginConfiguration,
  type PluginConfiguration,
  type PluginEntry,
  type PluginProfile
} from '../shared/plugins'
import type { PluginResolver } from './kernel'

export async function pluginProfile(
  root: string,
  profile: PluginProfile,
  base: readonly PluginEntry[]
): Promise<PluginEntry[]> {
  const config = await new JsonStore(join(root, 'plugins.json'), parsePluginConfiguration).read()
  return composedProfile(config, profile, base)
}

export function composedProfile(
  config: PluginConfiguration,
  profile: PluginProfile,
  base: readonly PluginEntry[]
): PluginEntry[] {
  let entries = [...base]
  const inactive = new Set<string>()
  for (const pkg of config.packages ?? []) {
    const rows = pkg.entries[profile] ?? []
    if (pkg.enabled) entries = composePlugins(entries, rows)
    else for (const row of rows) inactive.add(row.id)
  }
  const ids = new Set(entries.map(({ id }) => id))
  return composePlugins(
    entries,
    (config.profiles[profile] ?? []).filter(
      (row) => ids.has(row.id) || !inactive.has(row.id) || row.name !== undefined
    )
  )
}

export function pluginModulePath(root: string, name: string): string {
  if (isAbsolute(name)) return name
  if (name.startsWith('.')) return resolve(root, name)
  const url = resolveModule(name, pathToFileURL(join(root, 'plugins', 'package.json')).href)
  if (!url.startsWith('file:')) throw new Error(`插件必须解析到本地模块：${name}`)
  return fileURLToPath(url)
}

export function pluginResolver(
  root: string,
  builtins: Readonly<Record<string, Plugin>>
): PluginResolver {
  return async (name) => {
    if (Object.hasOwn(builtins, name)) return builtins[name]
    if (name === 'eli.dsh-tree') return (await import('./dsh-tree')).dshTree(root)
    const path = pluginModulePath(root, name)
    const loaded = await import(pathToFileURL(path).href)
    const plugin: unknown = loaded.default ?? loaded
    if (
      typeof plugin !== 'function' &&
      (!plugin ||
        typeof plugin !== 'object' ||
        !('apply' in plugin) ||
        typeof plugin.apply !== 'function')
    ) {
      throw new Error(`无效的 Cordis 插件：${name}`)
    }
    return plugin as Plugin
  }
}
