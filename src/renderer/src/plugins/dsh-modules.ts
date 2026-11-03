import * as React from 'react'
import * as ReactDom from 'react-dom'
import * as ReactClient from 'react-dom/client'
import * as JsxRuntime from 'react/jsx-runtime'
import * as Cordis from '@deepseek-ai/cordis'
import * as Slots from '@deepseek-ai/dsh-client-ui-slots'
import type { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { getAppPreferences, subscribeAppPreferences } from '../lib/app-preferences'
import type { PluginEntry } from '../../../shared/plugins'

type Factory = { id: string; factory(require: (name: string) => unknown): unknown }
declare global {
  interface Window {
    __ModuleLoader__: { load(factory: Factory): void }
  }
}
const platform: Record<string, unknown> = {
  react: React,
  'react-dom': ReactDom,
  'react-dom/client': ReactClient,
  'react/jsx-runtime': JsxRuntime,
  '@deepseek-ai/cordis': Cordis,
  '@deepseek-ai/dsh-client-ui-slots': Slots
}
const files = new Map<string, { esm: Record<string, unknown>; definition?: Factory }>()
const bundledClients = new Map<string, () => Promise<Record<string, unknown>>>([
  ['dsh.ui-renderer', () => import('@deepseek-ai/dsh-client-ui-renderer/client')],
  ['eli.dsh-locale', () => import('@deepseek-ai/dsh-client-locale/client')]
])
let registering: Factory | undefined
window.__ModuleLoader__ = {
  load(factory) {
    if (!factory || typeof factory.id !== 'string' || typeof factory.factory !== 'function')
      throw new Error('无效的 dsh 界面模块')
    registering = factory
  }
}

export async function clientModuleResolver(
  entries: readonly PluginEntry[],
  builtins: Readonly<Record<string, Cordis.Plugin>>
) {
  const definitions = new Map<string, Factory>()
  const cache = new Map<string, unknown>()
  const modules = new Set([
    ...bundledClients.keys(),
    ...entries
      .filter((row) => !row.disabled && !Object.hasOwn(builtins, row.name))
      .map((row) => row.name)
  ])
  for (const id of modules) {
    const loadBundled = bundledClients.get(id)
    if (!loadBundled && !id.startsWith('eli-plugin://')) throw new Error('无效的界面插件来源')
    let file = files.get(id)
    if (!file) {
      registering = undefined
      const esm = loadBundled ? await loadBundled() : await import(/* @vite-ignore */ id)
      file = { esm, definition: registering }
      files.set(id, file)
    }
    if (file.definition) definitions.set(file.definition.id, file.definition)
  }
  const { dshPlatform } = await import('./dsh-platform')
  function requireModule(name: string): unknown {
    if (Object.hasOwn(platform, name)) return platform[name]
    if (Object.hasOwn(dshPlatform, name)) return dshPlatform[name]
    if (cache.has(name)) return cache.get(name)
    const definition = definitions.get(name) ?? definitions.get(name.replace(/\/client$/, ''))
    if (!definition) throw new Error('插件缺少 dsh 客户端模块：' + name)
    const result = definition.factory(requireModule)
    cache.set(name, result)
    return result
  }
  return (name: string): Cordis.Plugin => {
    if (name === 'eli.dsh-locale')
      return {
        inject: ['slots'],
        apply(ctx: Cordis.Context) {
          const module = requireModule('@deepseek-ai/dsh-client-locale') as {
            LocaleRuntime: typeof LocaleRuntime
          }
          const language = (): string => (getAppPreferences().language === 'en' ? 'en' : 'zh')
          const locale = new module.LocaleRuntime(ctx, undefined, {
            languages: [language()],
            preference: language()
          })
          ctx.provide('locale', locale)
          ctx.slots.installLocale(locale)
          ctx.effect(() =>
            subscribeAppPreferences(() => {
              if (locale.getLocale().active !== language()) locale.setLocale(language())
            })
          )
        }
      }
    if (name === 'dsh.ui-renderer')
      return requireModule('@deepseek-ai/dsh-client-ui-renderer') as Cordis.Plugin
    if (Object.hasOwn(builtins, name)) return builtins[name]
    const file = files.get(name)
    const value = file?.definition
      ? requireModule(file.definition.id)
      : (file?.esm.default ?? file?.esm)
    if (
      typeof value !== 'function' &&
      (!value ||
        typeof value !== 'object' ||
        !('apply' in value) ||
        typeof value.apply !== 'function')
    )
      throw new Error('无效的 Cordis 界面插件：' + name)
    return value as Cordis.Plugin
  }
}
