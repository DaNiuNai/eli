import { createContext, useContext } from 'react'
import type { UiRegistry } from './registry'

export const PluginContext = createContext<UiRegistry | null>(null)
export function usePluginRegistry(): UiRegistry {
  const registry = useContext(PluginContext)
  if (!registry) throw new Error('界面插件尚未初始化')
  return registry
}
