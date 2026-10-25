import type { AuthType, Model, Api } from '@earendil-works/pi-ai'
import { join } from 'node:path'
import { EliConfigStore } from '../config/store'
import {
  providerApis,
  type ProviderChange,
  type ProviderView,
  type ProvidersSnapshot,
  type ProviderModelInput
} from '../shared/providers'
import { createEliModels, type EliModels } from './models'
import { updateProviderPreferences } from './provider-store'
import { createSettings } from './settings'
import { configureNetwork } from './network'

function text(value: unknown, label: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    throw new Error(`${label}格式无效`)
  return value.trim()
}
function endpoint(value: unknown): string {
  const url = new URL(text(value, 'API 地址', 2048))
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  )
    throw new Error('API 地址须为不含凭据、查询参数或片段的 HTTP(S) 地址')
  return url.href.replace(/\/+$/, '')
}
function parseModel(value: ProviderModelInput): ProviderModelInput {
  if (!value || typeof value !== 'object') throw new Error('模型格式无效')
  if (
    typeof value.reasoning !== 'boolean' ||
    (value.supportsXhigh !== undefined && typeof value.supportsXhigh !== 'boolean') ||
    (value.supportsMax !== undefined && typeof value.supportsMax !== 'boolean') ||
    typeof value.vision !== 'boolean' ||
    !Number.isSafeInteger(value.contextWindow) ||
    value.contextWindow < 1 ||
    value.contextWindow > 100_000_000 ||
    !Number.isSafeInteger(value.maxTokens) ||
    value.maxTokens < 1 ||
    value.maxTokens > value.contextWindow
  )
    throw new Error('模型能力或 token 上限无效')
  return {
    id: text(value.id, '模型 ID', 300),
    name: text(value.name, '模型名称'),
    reasoning: value.reasoning,
    ...(value.supportsXhigh === undefined ? {} : { supportsXhigh: value.supportsXhigh }),
    ...(value.supportsMax === undefined ? {} : { supportsMax: value.supportsMax }),
    vision: value.vision,
    contextWindow: value.contextWindow,
    maxTokens: value.maxTokens
  }
}
function viewModel(model: Model<Api>): ProviderModelInput {
  return {
    id: model.id,
    name: model.name,
    reasoning: model.reasoning,
    supportsXhigh: typeof model.thinkingLevelMap?.xhigh === 'string',
    supportsMax: typeof model.thinkingLevelMap?.max === 'string',
    vision: model.input.includes('image'),
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens
  }
}

export class ProvidersService {
  private cached?: Promise<EliModels>
  private pending: Promise<void> = Promise.resolve()
  private loginProvider?: string
  constructor(
    private readonly root: string,
    private readonly changed: () => void
  ) {}

  models(type?: AuthType): Promise<EliModels> {
    if (type) return createEliModels(this.root, type)
    this.cached ??= createEliModels(this.root).catch((error: unknown) => {
      this.cached = undefined
      throw error
    })
    return this.cached
  }
  beginLogin(id: string): void {
    if (this.loginProvider) throw new Error('请先完成或取消当前登录')
    this.loginProvider = id
  }
  endLogin(): void {
    this.loginProvider = undefined
  }
  async authenticated(id: string, type: AuthType): Promise<void> {
    await updateProviderPreferences(this.root, (all) => {
      all[id] = {
        ...all[id],
        enabled: true,
        authMode: type,
        ...(type === 'api_key' ? { keyRemoved: false } : {})
      }
    })
    this.cached = undefined
    this.changed()
  }
  async get(): Promise<ProvidersSnapshot> {
    const { runtime, credentials, preferences, builtinIds, catalog } = await this.models()
    const providers = await Promise.all(
      runtime.getProviders().map(async (provider): Promise<ProviderView> => {
        const pref = preferences[provider.id] ?? {}
        const [apiKey, oauth, authMode] = await Promise.all([
          credentials.getStored(provider.id, 'api_key'),
          credentials.getStored(provider.id, 'oauth'),
          credentials.mode(provider.id)
        ])
        const apiKeyConfigured =
          !!apiKey || (!pref.keyRemoved && credentials.explicitKeys.has(provider.id))
        return {
          id: provider.id,
          name: provider.name,
          custom: !builtinIds.has(provider.id),
          added:
            !builtinIds.has(provider.id) ||
            Object.hasOwn(preferences, provider.id) ||
            apiKeyConfigured ||
            !!oauth,
          enabled: pref.enabled !== false,
          baseUrl: pref.baseUrl ?? provider.baseUrl ?? catalog(provider.id)[0]?.baseUrl ?? '',
          api: pref.api ?? catalog(provider.id)[0]?.api ?? 'openai-completions',
          authMode,
          apiKeySupported: !!provider.auth.apiKey?.login,
          apiKeyConfigured,
          oauthSupported: !!provider.auth.oauth,
          oauthConfigured: !!oauth,
          oauthName: provider.auth.oauth?.name,
          models: catalog(provider.id).map((model) => ({
            ...viewModel(model),
            enabled: !pref.disabledModels?.includes(model.id),
            custom: pref.models?.some((item) => item.id === model.id) ?? false
          }))
        }
      })
    )
    return { providers: providers.sort((a, b) => a.name.localeCompare(b.name)) }
  }
  change(value: ProviderChange): Promise<ProvidersSnapshot> {
    const operation = this.pending.then(async () => {
      if (!value || typeof value !== 'object') throw new Error('无效的供应商操作')
      const id = text(value.id, '供应商 ID')
      if (['__proto__', 'constructor', 'prototype'].includes(id)) throw new Error('无效的供应商 ID')
      if (this.loginProvider === id) throw new Error('请先完成或取消此供应商的登录')
      await this.apply({ ...value, id })
      this.cached = undefined
      this.changed()
      return this.get()
    })
    this.pending = operation.then(
      () => {},
      () => {}
    )
    return operation
  }
  private async apply(change: ProviderChange): Promise<void> {
    const bundle = await this.models()
    const { runtime, preferences, builtinIds } = bundle
    const { id } = change
    const provider = runtime.getProvider(id)
    if (change.action !== 'create' && !provider) throw new Error('供应商不存在')
    switch (change.action) {
      case 'addBuiltin': {
        if (!builtinIds.has(id)) throw new Error('请选择有效的内置供应商')
        if (!provider?.auth.apiKey?.login && !provider?.auth.oauth)
          throw new Error('此内置供应商没有可用的登录方式')
        const mode = await bundle.credentials.mode(id)
        const authMode =
          mode === 'oauth' && provider.auth.oauth
            ? 'oauth'
            : provider.auth.apiKey?.login
              ? 'api_key'
              : 'oauth'
        await updateProviderPreferences(this.root, (all) => {
          all[id] ??= { enabled: true, authMode }
        })
        return
      }
      case 'create': {
        if (provider || !/^[a-z][a-z0-9_-]{0,63}$/.test(id))
          throw new Error('供应商 ID 已存在或格式无效')
        if (!providerApis.includes(change.api)) throw new Error('不支持的 API 协议')
        const config = {
          custom: true,
          name: text(change.name, '供应商名称'),
          baseUrl: endpoint(change.baseUrl),
          api: change.api,
          enabled: true,
          authMode: 'api_key' as const,
          models: []
        }
        await updateProviderPreferences(this.root, (all) => {
          all[id] = config
        })
        return
      }
      case 'update': {
        const next = { ...preferences[id] }
        if (change.name !== undefined) next.name = text(change.name, '供应商名称')
        if (change.baseUrl !== undefined) next.baseUrl = endpoint(change.baseUrl)
        if (change.enabled !== undefined) {
          if (typeof change.enabled !== 'boolean') throw new Error('无效的启停状态')
          next.enabled = change.enabled
        }
        if (change.authMode !== undefined) {
          if (change.authMode !== 'api_key' && change.authMode !== 'oauth')
            throw new Error('无效的认证方式')
          if (change.authMode === 'oauth' ? !provider?.auth.oauth : !provider?.auth.apiKey)
            throw new Error('供应商不支持此认证方式')
          next.authMode = change.authMode
        }
        await updateProviderPreferences(this.root, (all) => {
          all[id] = next
        })
        return
      }
      case 'saveKey': {
        if (!provider?.auth.apiKey?.login) throw new Error('供应商不支持 API Key 登录')
        const key = text(change.key, 'API Key', 32768)
        const api = await this.models('api_key')
        await api.credentials.modify(id, async () => ({ type: 'api_key', key }))
        await updateProviderPreferences(this.root, (all) => {
          all[id] = { ...all[id], enabled: true, authMode: 'api_key', keyRemoved: false }
        })
        return
      }
      case 'logout': {
        if (change.type !== 'api_key' && change.type !== 'oauth') throw new Error('无效的认证方式')
        const model = await this.models(change.type)
        await model.runtime.logout(id)
        if (change.type === 'api_key')
          await updateProviderPreferences(this.root, (all) => {
            all[id] = { ...all[id], keyRemoved: true }
          })
        return
      }
      case 'delete': {
        await new EliConfigStore(join(this.root, 'config.json')).update((config) => {
          delete config.providers[id]
          delete config.credentials[`api_key:${id}`]
          delete config.credentials[`oauth:${id}`]
        })
        return
      }
      case 'saveModel': {
        const model = parseModel(change.model)
        await updateProviderPreferences(this.root, (all) => {
          const pref = (all[id] ??= {})
          pref.models = [...(pref.models ?? []).filter((item) => item.id !== model.id), model]
          pref.disabledModels = pref.disabledModels?.filter((item) => item !== model.id)
        })
        return
      }
      case 'setModelEnabled':
      case 'removeModel': {
        const modelId = text(change.modelId, '模型 ID', 300)
        if (!bundle.catalog(id).some((model) => model.id === modelId)) throw new Error('模型不存在')
        if (change.action === 'setModelEnabled' && typeof change.enabled !== 'boolean')
          throw new Error('无效的模型状态')
        await updateProviderPreferences(this.root, (all) => {
          const pref = (all[id] ??= {})
          const disabled = new Set(pref.disabledModels)
          if (change.action === 'setModelEnabled' && change.enabled) disabled.delete(modelId)
          else disabled.add(modelId)
          pref.disabledModels = [...disabled]
          if (change.action === 'removeModel')
            pref.models = pref.models?.filter((model) => model.id !== modelId)
        })
        return
      }
      case 'sync':
        await this.sync(bundle, id)
        return
      default:
        throw new Error('无效的供应商操作')
    }
  }

  private async sync(bundle: EliModels, id: string): Promise<void> {
    const { runtime, preferences, builtinIds } = bundle
    const provider = runtime.getProvider(id)!
    await configureNetwork(await createSettings(this.root))
    const controller = AbortSignal.timeout(25_000)
    if (
      builtinIds.has(id) &&
      (!preferences[id]?.baseUrl || (await bundle.credentials.mode(id)) === 'oauth')
    ) {
      const result = await runtime.refresh({
        providers: [id],
        allowNetwork: true,
        force: true,
        signal: controller
      })
      if (result.errors.has(id)) throw new Error(`模型同步失败：${result.errors.get(id)!.message}`)
      // SDK 的模型目录缓存负责持久化；不能把订阅目录写成 API Key 的自定义模型。
      return
    }
    const auth = await runtime.getAuth(id, { signal: controller })
    if (!auth) throw new Error('请先配置当前认证方式')
    const baseUrl = endpoint(preferences[id]?.baseUrl ?? provider.baseUrl)
    const api = preferences[id]?.api ?? bundle.catalog(id)[0]?.api ?? 'openai-completions'
    const headers: Record<string, string> = Object.fromEntries(
      Object.entries(auth.auth.headers ?? {}).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'
      )
    )
    if (auth.auth.apiKey) {
      if (api === 'anthropic-messages') {
        headers['x-api-key'] = auth.auth.apiKey
        headers['anthropic-version'] = '2023-06-01'
      } else if (api === 'google-generative-ai') headers['x-goog-api-key'] = auth.auth.apiKey
      else headers.Authorization = `Bearer ${auth.auth.apiKey}`
    }
    const response = await fetch(`${baseUrl}/models`, {
      headers,
      signal: controller,
      redirect: 'error'
    })
    if (!response.ok) throw new Error(`模型同步失败（HTTP ${response.status}）`)
    const body = await response.text()
    if (body.length > 4_000_000) throw new Error('模型列表过大')
    const parsed = JSON.parse(body)
    const rows = parsed.data ?? parsed.models
    if (!Array.isArray(rows) || rows.length > 10000) throw new Error('供应商未返回有效模型列表')
    const existing = new Map(bundle.catalog(id).map((model) => [model.id, viewModel(model)]))
    for (const row of rows) {
      const modelId = text(row.id ?? row.name?.replace(/^models\//, ''), '模型 ID', 300)
      if (!existing.has(modelId))
        existing.set(modelId, {
          id: modelId,
          name: row.displayName ?? row.name ?? modelId,
          reasoning: false,
          vision: false,
          contextWindow: 128000,
          maxTokens: 8192
        })
    }
    await updateProviderPreferences(this.root, (all) => {
      all[id] = { ...all[id], models: [...existing.values()] }
    })
  }
}
