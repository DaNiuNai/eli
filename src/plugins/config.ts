import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve as resolveModule } from 'import-meta-resolve'
import type { Plugin } from '@deepseek-ai/cordis'
import { JsonStore } from '../config/store'
import {
  composePlugins,
  parsePluginConfiguration,
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
  return composePlugins(base, config.profiles[profile] ?? [])
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
