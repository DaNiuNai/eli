import {
  createElement,
  Fragment,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode
} from 'react'
import { usePluginRegistry } from './context'
import type { UiSlots } from './contracts'

export function PluginSlot<K extends keyof UiSlots>({
  name,
  ...props
}: { name: K } & UiSlots[K]): React.JSX.Element {
  const registry = usePluginRegistry()
  const entries = useSyncExternalStore(registry.subscribe, () => registry.read(name))
  return (
    <>
      {entries.map((entry) => (
        <Fragment key={entry.id}>
          {createElement(entry.component as ComponentType<object>, props)}
        </Fragment>
      ))}
    </>
  )
}

export function PluginProviders({ children }: { children: ReactNode }): React.JSX.Element {
  const registry = usePluginRegistry()
  const entries = useSyncExternalStore(registry.subscribe, () => registry.read('providers'))
  return (
    <>
      {entries.reduceRight<ReactNode>(
        (node, entry) => (
          <entry.component key={entry.id}>{node}</entry.component>
        ),
        children
      )}
    </>
  )
}
