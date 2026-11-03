import bundles from '../../resources/plugin-bundles.json' with { type: 'json' }
import type { PluginEntry } from './plugins'

export function builtinBundle(name: keyof typeof bundles): PluginEntry[] {
  return structuredClone(bundles[name])
}
