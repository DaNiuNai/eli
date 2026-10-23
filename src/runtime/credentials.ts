import type {
  AuthOperationOptions,
  AuthType,
  Credential,
  CredentialInfo,
  CredentialStore
} from '@earendil-works/pi-ai'
import { EliConfigStore } from '../config/store'
import type { ProviderPreferencesMap } from './provider-store'

const slot = (id: string, type: AuthType): string => `${type}:${id}`

/** SDK 只通过注入的接口访问 Eli 凭据，不读取或修改 SDK 的 auth.json。 */
export class EliCredentials implements CredentialStore {
  readonly explicitKeys = new Map<string, string>()
  constructor(
    private readonly store: EliConfigStore,
    readonly preferences: ProviderPreferencesMap,
    private readonly forcedMode?: AuthType
  ) {}

  async initialize(): Promise<void> {
    await this.store.read()
  }

  async getStored(id: string, type: AuthType): Promise<Credential | undefined> {
    return (await this.store.read()).credentials[slot(id, type)]
  }
  async mode(id: string): Promise<AuthType> {
    if (this.forcedMode) return this.forcedMode
    if (this.preferences[id]?.authMode) return this.preferences[id].authMode!
    const { credentials } = await this.store.read()
    return credentials[slot(id, 'api_key')] || this.explicitKeys.has(id)
      ? 'api_key'
      : credentials[slot(id, 'oauth')]
        ? 'oauth'
        : 'api_key'
  }
  async read(id: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
    options?.signal?.throwIfAborted()
    if (!this.forcedMode && this.preferences[id]?.enabled === false) return undefined
    const type = await this.mode(id)
    return (
      (await this.getStored(id, type)) ??
      (type === 'api_key' && !this.preferences[id]?.keyRemoved && this.explicitKeys.has(id)
        ? { type: 'api_key', key: this.explicitKeys.get(id) }
        : undefined)
    )
  }
  async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
    const { credentials } = await this.store.read()
    const entries = await Promise.all(
      [
        ...new Set([
          ...Object.keys(credentials).map((key) => key.replace(/^(?:api_key|oauth):/, '')),
          ...this.explicitKeys.keys()
        ])
      ].map(async (providerId) => {
        const credential = await this.read(providerId, options)
        return credential ? { providerId, type: credential.type } : undefined
      })
    )
    return entries.filter((entry): entry is CredentialInfo => !!entry)
  }
  async modify(
    id: string,
    fn: (value: Credential | undefined) => Promise<Credential | undefined>,
    options?: AuthOperationOptions
  ): Promise<Credential | undefined> {
    const type = await this.mode(id)
    return this.store.update(async ({ credentials }) => {
      const current = credentials[slot(id, type)]
      const next = await fn(current)
      if (!next) return current
      if (next.type !== type) throw new Error('凭据类型不匹配')
      credentials[slot(id, type)] = next
      return next
    }, options?.signal)
  }
  async delete(id: string, options?: AuthOperationOptions): Promise<void> {
    const type = await this.mode(id)
    await this.store.update(({ credentials }) => {
      delete credentials[slot(id, type)]
    }, options?.signal)
  }
}
