import { join } from 'node:path'
import { EliConfigStore } from '../config/store'
import type { ProviderPreferencesMap } from '../config/schema'

export type { ProviderPreferences, ProviderPreferencesMap } from '../config/schema'

export async function readProviderPreferences(root: string): Promise<ProviderPreferencesMap> {
  return (await new EliConfigStore(join(root, 'config.json')).read()).providers
}

export async function updateProviderPreferences(
  root: string,
  change: (providers: ProviderPreferencesMap) => void
): Promise<void> {
  await new EliConfigStore(join(root, 'config.json')).update((config) => change(config.providers))
}
