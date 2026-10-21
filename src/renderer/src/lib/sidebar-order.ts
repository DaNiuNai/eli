import type { SavedSession } from '../../../shared/pi-library'

interface SidebarOrder {
  workspaces: string[]
  sessions: Record<string, string[]>
}

const storageKey = 'eli-sidebar-order-v1'
const listeners = new Set<() => void>()
let snapshot: SidebarOrder | undefined

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === 'string'))]
    : []
}

export function getSidebarOrder(): SidebarOrder {
  if (snapshot) return snapshot
  snapshot = { workspaces: [], sessions: {} }
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      const value = saved as Record<string, unknown>
      const sessions = value.sessions
      snapshot = {
        workspaces: stringList(value.workspaces),
        sessions:
          sessions && typeof sessions === 'object' && !Array.isArray(sessions)
            ? Object.fromEntries(
                Object.entries(sessions).map(([cwd, paths]) => [cwd, stringList(paths)])
              )
            : {}
      }
    }
  } catch {
    // 本地存储不可用或数据损坏时，仍然允许本次排序。
  }
  return snapshot
}

export function subscribeSidebarOrder(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function saveOrder(next: SidebarOrder): void {
  snapshot = next
  try {
    localStorage.setItem(storageKey, JSON.stringify(next))
  } catch {
    // 保存失败不影响当前窗口的顺序。
  }
  for (const listener of listeners) listener()
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
