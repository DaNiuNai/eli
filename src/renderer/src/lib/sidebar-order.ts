import type { SavedSession } from '../../../shared/pi-library'
import type { SidebarOrder } from '../../../shared/app-preferences'
import { getAppPreferences, updateAppPreferences } from './app-preferences'

export { subscribeAppPreferences as subscribeSidebarOrder } from './app-preferences'

export function getSidebarOrder(): SidebarOrder {
  return getAppPreferences().sidebarOrder
}

function saveOrder(next: SidebarOrder): void {
  updateAppPreferences({ sidebarOrder: next })
}

function appendNew(saved: string[], incoming: string[]): string[] {
  const known = new Set(saved)
  const added = [...new Set(incoming)].filter((id) => !known.has(id))
  return added.length ? [...saved, ...added] : saved
}

export function rememberSidebarSessions(sessions: SavedSession[]): void {
  const current = getSidebarOrder()
  const workspaces = appendNew(
    current.workspaces,
    sessions.map((session) => session.cwd)
  )
  const incoming = new Map<string, string[]>()
  for (const session of sessions) {
    const paths = incoming.get(session.cwd) ?? []
    paths.push(session.path)
    incoming.set(session.cwd, paths)
  }
  const nextSessions = { ...current.sessions }
  let changed = workspaces !== current.workspaces
  for (const [cwd, paths] of incoming) {
    const previous = current.sessions[cwd] ?? []
    const next = appendNew(previous, paths)
    if (next !== previous) {
      nextSessions[cwd] = next
      changed = true
    }
  }
  if (changed) saveOrder({ workspaces, sessions: nextSessions })
}

export function reorderSidebarWorkspaces(ordered: string[]): void {
  const current = getSidebarOrder()
  saveOrder({ ...current, workspaces: appendNew(ordered, current.workspaces) })
}

export function reorderSidebarSessions(cwd: string, ordered: string[]): void {
  const current = getSidebarOrder()
  saveOrder({
    ...current,
    sessions: {
      ...current.sessions,
      [cwd]: appendNew(ordered, current.sessions[cwd] ?? [])
    }
  })
}

export function orderSidebarItems<T>(items: T[], saved: string[], key: (item: T) => string): T[] {
  const ranks = new Map(saved.map((id, index) => [id, index]))
  return [...items].sort(
    (left, right) =>
      (ranks.get(key(left)) ?? saved.length) - (ranks.get(key(right)) ?? saved.length)
  )
}
