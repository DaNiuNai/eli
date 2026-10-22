import type {
  AuthOperationOptions,
  AuthType,
  Credential,
  CredentialInfo,
  CredentialStore
} from '@earendil-works/pi-ai'
import type { sdkModules } from './sdk-adapter'
import type { ProviderPreferencesMap } from './provider-store'

type Backend = InstanceType<Awaited<ReturnType<typeof sdkModules>>['FileAuthStorageBackend']>
type Data = Record<string, Credential>
const slot = (id: string, type: AuthType): string => `${type}:${id}`

/** 复用 SDK 的跨进程锁；密钥始终作为字面值读取，不执行命令或环境变量替换。 */
export class EliCredentials implements CredentialStore {
  readonly explicitKeys = new Map<string, string>()
  private types = new Map<string, Set<AuthType>>()
  constructor(
    private readonly backend: Backend,
    readonly preferences: ProviderPreferencesMap,
    private readonly forcedMode?: AuthType
  ) {}

  async initialize(): Promise<void> {
    const entries = await this.backend.withLockAsync(async (text) => ({
      result: Object.entries(text ? (JSON.parse(text) as Data) : {})
    }))
    for (const [key, value] of entries) {
      if (!value || (value.type !== 'api_key' && value.type !== 'oauth'))
        throw new Error('eli 凭据文件格式无效')
      const id = key.replace(/^(?:api_key|oauth):/, '')
      const types = this.types.get(id) ?? new Set<AuthType>()
      types.add(value.type)
      this.types.set(id, types)
    }
  }

  private stored(data: Data, id: string, type: AuthType): Credential | undefined {
    return data[slot(id, type)] ?? (data[id]?.type === type ? data[id] : undefined)
  }
  async getStored(id: string, type: AuthType): Promise<Credential | undefined> {
    if (!this.types.get(id)?.has(type)) return undefined
    return this.backend.withLockAsync(async (text) => ({
      result: this.stored(text ? JSON.parse(text) : {}, id, type)
    }))
  }
  async mode(id: string): Promise<AuthType> {
    if (this.forcedMode) return this.forcedMode
    if (this.preferences[id]?.authMode) return this.preferences[id].authMode!
    return this.types.get(id)?.has('api_key') || this.explicitKeys.has(id)
      ? 'api_key'
      : this.types.get(id)?.has('oauth')
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
    const entries = await Promise.all(
      [...new Set([...this.types.keys(), ...this.explicitKeys.keys()])].map(async (providerId) => {
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
    return this.backend.withLockAsync(async (text) => {
      const data: Data = text ? JSON.parse(text) : {}
      const current = this.stored(data, id, type)
      const next = await fn(current)
      if (!next) return { result: current }
      if (next.type !== type) throw new Error('凭据类型不匹配')
      data[slot(id, type)] = next
      const types = this.types.get(id) ?? new Set<AuthType>()
      types.add(type)
      this.types.set(id, types)
      if (data[id]?.type === type) delete data[id]
      return { result: next, next: JSON.stringify(data, null, 2) + '\n' }
    }, options)
  }
  async delete(id: string, options?: AuthOperationOptions): Promise<void> {
    const type = await this.mode(id)
    await this.backend.withLockAsync(async (text) => {
      const data: Data = text ? JSON.parse(text) : {}
      delete data[slot(id, type)]
      if (data[id]?.type === type) delete data[id]
      this.types.get(id)?.delete(type)
      return { result: undefined, next: JSON.stringify(data, null, 2) + '\n' }
    }, options)
  }
}
