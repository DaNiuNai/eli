import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import type { AuthType } from '@earendil-works/pi-ai'
import type { ProviderModelInput, ProviderApi } from '../shared/providers'
import { sdkModules } from './sdk-adapter'

export interface ProviderPreferences {
  name?: string
  custom?: boolean
  enabled?: boolean
  baseUrl?: string
  api?: ProviderApi
  authMode?: AuthType
  keyRemoved?: boolean
  models?: ProviderModelInput[]
  disabledModels?: string[]
}
export type ProviderPreferencesMap = Record<string, ProviderPreferences>

export async function readProviderPreferences(root: string): Promise<ProviderPreferencesMap> {
  try {
    const value = JSON.parse(await readFile(join(root, 'providers.json'), 'utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('供应商配置必须是对象')
    return value
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
}

export async function updateProviderPreferences(
  root: string,
  change: (providers: ProviderPreferencesMap) => void
): Promise<void> {
  const { FileAuthStorageBackend } = await sdkModules()
  const storage = new FileAuthStorageBackend(join(root, 'providers.json'))
  await storage.withLockAsync(async (current) => {
    const providers = current ? (JSON.parse(current) as ProviderPreferencesMap) : {}
    change(providers)
    return { result: undefined, next: JSON.stringify(providers, null, 2) + '\n' }
  })
}
