import type { AuthType } from '@earendil-works/pi-ai'

export const providerApis = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
  'google-generative-ai'
] as const
export type ProviderApi = (typeof providerApis)[number]
export interface ProviderModelInput {
  id: string
  name: string
  reasoning: boolean
  vision: boolean
  contextWindow: number
  maxTokens: number
}
export interface ProviderModelView extends ProviderModelInput {
  enabled: boolean
  custom: boolean
}
export interface ProviderView {
  id: string
  name: string
  custom: boolean
  enabled: boolean
  baseUrl: string
  api: string
  authMode: AuthType
  apiKeySupported: boolean
  apiKeyConfigured: boolean
  oauthSupported: boolean
  oauthConfigured: boolean
  oauthName?: string
  models: ProviderModelView[]
}
export interface ProvidersSnapshot {
  providers: ProviderView[]
}
export type ProviderChange =
  | { action: 'create'; id: string; name: string; baseUrl: string; api: ProviderApi }
  | {
      action: 'update'
      id: string
      name?: string
      baseUrl?: string
      enabled?: boolean
      authMode?: AuthType
    }
  | { action: 'delete'; id: string }
  | { action: 'saveKey'; id: string; key: string }
  | { action: 'logout'; id: string; type: AuthType }
  | { action: 'saveModel'; id: string; model: ProviderModelInput }
  | { action: 'setModelEnabled'; id: string; modelId: string; enabled: boolean }
  | { action: 'removeModel'; id: string; modelId: string }
  | { action: 'sync'; id: string }

export interface ProvidersApi {
  get(): Promise<ProvidersSnapshot>
  change(change: ProviderChange): Promise<ProvidersSnapshot>
  onChanged(listener: () => void): () => void
}
export const providersChannels = {
  get: 'providers:get',
  change: 'providers:change',
  changed: 'providers:changed'
} as const
