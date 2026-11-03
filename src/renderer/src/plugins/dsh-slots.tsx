import { useContext, useSyncExternalStore, type ReactNode } from 'react'
import { chatSeats, DshRenderContext, type Seat } from './dsh-context'
import { activeSessionId } from './dsh-session'

export function DshSlot({
  name,
  owner = {},
  children,
  entryKey
}: {
  name: Seat
  owner?: object
  children?: ReactNode
  entryKey?: string
}): ReactNode {
  const render = useContext(DshRenderContext)
  const id = useSyncExternalStore(activeSessionId.subscribe, activeSessionId.getSnapshot)
  if (!render || (chatSeats[name].scope === 'session' && !id)) return children ?? null
  return render(name, owner, { fallback: children, entryKey })
}
