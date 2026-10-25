import { join } from 'node:path'
import { ModelRuntime, type ProviderConfig } from '@earendil-works/pi-coding-agent'
import type { Api, AuthContext, AuthType, Provider, Model } from '@earendil-works/pi-ai'
import { sdkModules } from './sdk-adapter'
import { EliConfigStore } from '../config/store'
import { EliCredentials } from './credentials'
import { readProviderPreferences, type ProviderPreferencesMap } from './provider-store'
import type { ProviderModelInput } from '../shared/providers'

export const isolatedAuthContext: AuthContext = {
  env: async () => undefined,
  fileExists: async () => false
}

/** 将 SDK 提供商的认证解析限定为传入的显式凭据，登录和 OAuth 刷新仍使用原实现。 */
export function isolateProviderAuth(provider: Provider): void {
  const apiKey = provider.auth.apiKey
  if (!apiKey) return
  provider.auth.apiKey = {
    name: apiKey.name,
    login: apiKey.login?.bind(apiKey),
    check: async (input) => {
      if (!input.credential) return undefined
      const safe = { ...input, ctx: isolatedAuthContext }
      if (apiKey.check) return apiKey.check(safe)
      return (await apiKey.resolve(safe)) ? { type: 'api_key', source: 'eli' } : undefined
    },
    resolve: async (input) =>
      input.credential ? apiKey.resolve({ ...input, ctx: isolatedAuthContext }) : undefined
  }
}

export function modelDefinition(
  model: ProviderModelInput,
  api: string,
  baseUrl: string,
  provider: string,
  base?: Model<Api>
): Model<Api> {
  const thinkingLevelMap = { ...base?.thinkingLevelMap }
  if (model.supportsXhigh !== undefined)
    thinkingLevelMap.xhigh = model.supportsXhigh ? (base?.thinkingLevelMap?.xhigh ?? 'xhigh') : null
  if (model.supportsMax !== undefined)
    thinkingLevelMap.max = model.supportsMax ? (base?.thinkingLevelMap?.max ?? 'max') : null
  return {
    ...base,
    id: model.id,
    name: model.name,
    provider,
    api: api as Api,
    baseUrl,
    reasoning: model.reasoning,
    input: model.vision ? ['text', 'image'] : ['text'],
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    cost: base?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    ...(Object.keys(thinkingLevelMap).length ? { thinkingLevelMap } : {})
  }
}

export interface EliModels {
  runtime: ModelRuntime
  credentials: EliCredentials
  preferences: ProviderPreferencesMap
  builtinIds: Set<string>
  catalog(id: string): readonly Model<Api>[]
}

export async function createEliModels(root: string, forcedMode?: AuthType): Promise<EliModels> {
  const sdk = await sdkModules()
  const preferences = await readProviderPreferences(root)
  const credentials = new EliCredentials(
    new EliConfigStore(join(root, 'config.json')),
    preferences,
    forcedMode
  )
  await credentials.initialize()
  // 必须先禁用初始化检查；所有内置认证解析器完成隔离后，才允许枚举可用模型。
  const runtime = await ModelRuntime.create({
    credentials,
    modelsPath: null,
    modelsStore: new sdk.FileModelsStore(join(root, 'models-store.json')),
    refreshOnCreate: false
  })
  const builtins = new Map(runtime.getProviders().map((provider) => [provider.id, provider]))
  for (const provider of builtins.values()) isolateProviderAuth(provider)
  const builtinIds = new Set(builtins.keys())
  const modes = new Map<string, AuthType>()
  const catalogSources = new Map<string, () => readonly Model<Api>[]>()
  const emptyConfig = await sdk.ModelConfig.load(undefined)
  const registerNative = runtime.registerNativeProvider.bind(runtime)
  const unregister = runtime.unregisterProvider.bind(runtime)
  const extensionConfigs = new Map<string, ProviderConfig>()

  const decorate = (provider: Provider): Provider => {
    isolateProviderAuth(provider)
    const pref = preferences[provider.id] ?? {}
    const source = provider.getModels.bind(provider)
    const allSource = provider.getAllModels?.bind(provider) ?? source
    const catalog = (): readonly Model<Api>[] => {
      const subscription = modes.get(provider.id) === 'oauth'
      const api = (subscription ? undefined : pref.api) ?? source()[0]?.api ?? 'openai-completions'
      const endpoint = subscription
        ? (source()[0]?.baseUrl ?? provider.baseUrl ?? '')
        : (pref.baseUrl ?? provider.baseUrl ?? source()[0]?.baseUrl ?? '')
      const models = new Map(
        source().map((model) => [
          model.id,
          pref.baseUrl && modes.get(provider.id) !== 'oauth'
            ? { ...model, baseUrl: endpoint }
            : model
        ])
      )
      for (const model of pref.models ?? [])
        models.set(
          model.id,
          modelDefinition(model, api, endpoint, provider.id, models.get(model.id))
        )
      return [...models.values()]
    }
    catalogSources.set(provider.id, catalog)
    const visible = (): readonly Model<Api>[] =>
      pref.enabled === false
        ? []
        : catalog().filter((model) => !pref.disabledModels?.includes(model.id))
    return {
      ...provider,
      name: pref.name ?? provider.name,
      baseUrl:
        modes.get(provider.id) === 'oauth' ? provider.baseUrl : (pref.baseUrl ?? provider.baseUrl),
      getModels: visible,
      getAllModels: () =>
        pref.enabled === false
          ? []
          : [
              ...visible(),
              ...allSource().filter(
                (model) =>
                  model.type && model.type !== 'chat' && !pref.disabledModels?.includes(model.id)
              )
            ]
    }
  }

  // SDK 扩展也经过同一入口；其显式字面密钥可用，但没有环境变量／命令回退。
  runtime.registerNativeProvider = (provider) => registerNative(decorate(provider))
  runtime.registerProvider = (id, config) => {
    const merged = { ...extensionConfigs.get(id), ...config }
    extensionConfigs.set(id, merged)
    if (merged.apiKey !== undefined) credentials.explicitKeys.set(id, merged.apiKey)
    const safe = { ...merged }
    const headers = safe.headers
    delete safe.apiKey
    delete safe.headers
    const provider = sdk.composeModelProvider(id, builtins.get(id), emptyConfig, safe)
    if (headers && provider.auth.apiKey) {
      const resolve = provider.auth.apiKey.resolve.bind(provider.auth.apiKey)
      provider.auth.apiKey.resolve = async (input) => {
        const result = await resolve(input)
        return result
          ? { ...result, auth: { ...result.auth, headers: { ...result.auth.headers, ...headers } } }
          : undefined
      }
    }
    registerNative(decorate(provider))
  }
  runtime.unregisterProvider = (id) => {
    extensionConfigs.delete(id)
    credentials.explicitKeys.delete(id)
    unregister(id)
    const builtin = builtins.get(id)
    if (builtin) registerNative(decorate(builtin))
    else catalogSources.delete(id)
  }

  const ids = new Set([...builtinIds, ...Object.keys(preferences)])
  // 凭据模式固定在一次 Runtime 生命周期内，切换后主进程重建空闲会话。
  for (const id of ids) {
    modes.set(id, forcedMode ?? (await credentials.mode(id)))
  }
  for (const id of ids) {
    const pref = preferences[id] ?? {}
    if (pref.custom) {
      const base = builtins.get(id)
      const subscription = modes.get(id) === 'oauth' && !!base?.auth.oauth
      const api = subscription
        ? (base?.getModels()[0]?.api ?? 'openai-responses')
        : (pref.api ?? base?.getModels()[0]?.api ?? 'openai-completions')
      const endpoint = subscription ? (base?.baseUrl ?? '') : (pref.baseUrl ?? base?.baseUrl ?? '')
      runtime.registerProvider(id, {
        name: pref.name,
        baseUrl: endpoint,
        api: api as Api
      })
    } else {
      const builtin = builtins.get(id)
      if (builtin && Object.keys(pref).length) registerNative(decorate(builtin))
      else if (builtin) catalogSources.set(id, builtin.getModels.bind(builtin))
    }
  }
  await runtime.refresh({ allowNetwork: false })
  return {
    runtime,
    credentials,
    preferences,
    builtinIds,
    catalog: (id) => catalogSources.get(id)?.() ?? []
  }
}

export async function createModels(root: string): Promise<ModelRuntime> {
  return (await createEliModels(root)).runtime
}
