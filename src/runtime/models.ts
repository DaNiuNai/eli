import { join } from 'node:path'
import { builtinModels } from '@earendil-works/pi-ai/providers/all'
import { createProvider, envApiKeyAuth } from '@earendil-works/pi-ai'
import type {
  Api,
  AuthContext,
  AuthType,
  Provider,
  Model,
  MutableModels,
  ProviderStreams
} from '@earendil-works/pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy'
import { googleGenerativeAIApi } from '@earendil-works/pi-ai/api/google-generative-ai.lazy'
import { EliConfigStore } from '../config/store'
import { EliCredentials } from './credentials'
import type { ProviderPreferencesMap } from './provider-store'
import type { ProviderModelInput } from '../shared/providers'
import { guardModelRequests, type RequestBodyListener } from './request-body'
import { FileModelsStore } from './model-store'

export const isolatedAuthContext: AuthContext = {
  env: async () => undefined,
  fileExists: async () => false
}

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

export type EliModelRuntime = MutableModels & {
  registerNativeProvider(provider: Provider): void
  hasConfiguredAuth(id: string): boolean
}
export interface EliModels {
  runtime: EliModelRuntime
  credentials: EliCredentials
  preferences: ProviderPreferencesMap
  builtinIds: Set<string>
  catalog(id: string): readonly Model<Api>[]
  subscribe(listener: () => void): () => void
}

const protocols: Record<string, () => ProviderStreams> = {
  'openai-completions': openAICompletionsApi,
  'openai-responses': openAIResponsesApi,
  'anthropic-messages': anthropicMessagesApi,
  'google-generative-ai': googleGenerativeAIApi
}

/** pi-ai 只提供模型与认证适配；会话、工具执行和循环全部由 dsh 插件持有。 */
export async function createEliModels(
  root: string,
  forcedMode?: AuthType,
  onRequestBody?: RequestBodyListener
): Promise<EliModels> {
  const store = new EliConfigStore(join(root, 'config.json'))
  const { providers: preferences, agent } = await store.read()
  const credentials = new EliCredentials(store, preferences, forcedMode)
  await credentials.initialize()
  const collection = builtinModels({
    credentials,
    authContext: isolatedAuthContext,
    modelsStore: new FileModelsStore(join(root, 'models-store.json'))
  })
  const builtins = new Map(collection.getProviders().map((provider) => [provider.id, provider]))
  const builtinIds = new Set(builtins.keys())
  const modes = new Map<string, AuthType>()
  for (const id of new Set([...builtinIds, ...Object.keys(preferences)])) {
    modes.set(id, forcedMode ?? (await credentials.mode(id)))
  }
  const catalogs = new Map<string, () => readonly Model<Api>[]>()
  const listeners = new Set<() => void>()
  const register = (provider: Provider): void => {
    isolateProviderAuth(provider)
    const pref = preferences[provider.id] ?? {}
    const subscription = modes.get(provider.id) === 'oauth'
    const source = provider.getModels.bind(provider)
    const allSource = provider.getAllModels?.bind(provider) ?? source
    const catalog = (): readonly Model<Api>[] => {
      const api = (!subscription && pref.api) || source()[0]?.api || 'openai-completions'
      const endpoint =
        (!subscription && pref.baseUrl) || provider.baseUrl || source()[0]?.baseUrl || ''
      const models = new Map(
        source().map((model) => [
          model.id,
          !subscription && pref.baseUrl ? { ...model, baseUrl: endpoint } : model
        ])
      )
      for (const model of pref.models ?? []) {
        models.set(
          model.id,
          modelDefinition(model, api, endpoint, provider.id, models.get(model.id))
        )
      }
      return [...models.values()]
    }
    catalogs.set(provider.id, catalog)
    const visible = (): readonly Model<Api>[] =>
      pref.enabled === false
        ? []
        : catalog().filter((model) => !pref.disabledModels?.includes(model.id))
    const decorated: Provider = {
      ...provider,
      stream: (model, context, options) =>
        provider.stream(model, context, { ...options, ...agent.retry?.provider } as typeof options),
      streamSimple: (model, context, options) =>
        provider.streamSimple(model, context, { ...options, ...agent.retry?.provider }),
      name: pref.name ?? provider.name,
      baseUrl: subscription ? provider.baseUrl : (pref.baseUrl ?? provider.baseUrl),
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
    guardModelRequests(decorated, onRequestBody, agent.images?.blockImages)
    collection.setProvider(decorated)
    for (const listener of listeners) listener()
  }
  for (const provider of builtins.values()) register(provider)
  for (const [id, pref] of Object.entries(preferences)) {
    const base = builtins.get(id)
    if (!pref.custom && (!pref.api || pref.api === base?.getModels()[0]?.api)) continue
    if (base && modes.get(id) === 'oauth') continue
    const api = pref.api ?? base?.getModels()[0]?.api ?? 'openai-completions'
    const protocol = protocols[api]
    if (!protocol) throw new Error(`供应商 ${id} 使用了不支持的 API：${api}`)
    register(
      createProvider({
        id,
        name: pref.name ?? base?.name ?? id,
        baseUrl: pref.baseUrl ?? base?.baseUrl,
        models: base?.getModels() ?? [],
        auth: { apiKey: base?.auth.apiKey ?? envApiKeyAuth(pref.name ?? id, []) },
        api: protocol()
      })
    )
  }
  const configured = new Set((await credentials.list()).map(({ providerId }) => providerId))
  const runtime = Object.assign(collection, {
    registerNativeProvider: register,
    hasConfiguredAuth: (id: string): boolean =>
      preferences[id]?.enabled !== false && configured.has(id)
  })
  guardModelRequests(runtime, onRequestBody, agent.images?.blockImages)
  await runtime.refresh({ allowNetwork: false })
  return {
    runtime,
    credentials,
    preferences,
    builtinIds,
    catalog: (id) => catalogs.get(id)?.() ?? [],
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}

export async function createModels(
  root: string,
  onRequestBody?: RequestBodyListener
): Promise<EliModelRuntime> {
  return (await createEliModels(root, undefined, onRequestBody)).runtime
}
