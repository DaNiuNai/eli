import type { Credential } from '@earendil-works/pi-ai'
import type { SettingsManager } from '@earendil-works/pi-coding-agent'
import { parseAppPreferences, type AppPreferences } from '../shared/app-preferences'
import type { ProviderApi, ProviderModelInput } from '../shared/providers'

export interface ProviderPreferences {
  name?: string
  custom?: boolean
  enabled?: boolean
  baseUrl?: string
  api?: ProviderApi
  authMode?: 'api_key' | 'oauth'
  keyRemoved?: boolean
  models?: ProviderModelInput[]
  disabledModels?: string[]
}

export type ProviderPreferencesMap = Record<string, ProviderPreferences>
export type AgentSettings = ReturnType<SettingsManager['getGlobalSettings']>

/** Eli 唯一的配置文档；凭据只在主进程和 Runtime 中访问。 */
export interface EliConfig {
  version: 1
  app: AppPreferences
  agent: AgentSettings
  providers: ProviderPreferencesMap
  credentials: Record<string, Credential>
  deviceId?: string
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function parseEliConfig(value: unknown): EliConfig {
  if (!record(value)) throw new Error('Eli 配置必须是 JSON 对象')
  if (value.version !== undefined && value.version !== 1) throw new Error('不支持的 Eli 配置版本')
  for (const key of ['agent', 'providers', 'credentials'] as const) {
    if (value[key] !== undefined && !record(value[key]))
      throw new Error(`Eli ${key} 配置必须是对象`)
  }
  for (const credential of Object.values(value.credentials ?? {})) {
    if (!record(credential) || !['api_key', 'oauth'].includes(String(credential.type)))
      throw new Error('Eli 凭据格式无效')
  }
  if (value.deviceId !== undefined && typeof value.deviceId !== 'string')
    throw new Error('Eli 设备 ID 格式无效')
  // 只识别新结构，不迁移旧配置文件或旧的顶层应用偏好。
  return {
    version: 1,
    app: parseAppPreferences(value.app ?? {}),
    agent: structuredClone((value.agent ?? {}) as AgentSettings),
    providers: structuredClone((value.providers ?? {}) as ProviderPreferencesMap),
    credentials: structuredClone((value.credentials ?? {}) as Record<string, Credential>),
    ...(value.deviceId === undefined ? {} : { deviceId: value.deviceId })
  }
}
