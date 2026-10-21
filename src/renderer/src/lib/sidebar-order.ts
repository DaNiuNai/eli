import type { SavedSession } from '../../../shared/pi-library'
import type { SidebarOrder } from '../../../shared/app-preferences'
import type { PiLiveSession } from '../../../shared/pi'
import { getAppPreferences, updateAppPreferences } from './app-preferences'

export { subscribeAppPreferences as subscribeSidebarOrder } from './app-preferences'

export function getSidebarOrder(): SidebarOrder {
  return getAppPreferences().sidebarOrder
}

function saveOrder(next: SidebarOrder): void {
  updateAppPreferences({ sidebarOrder: next })
}

function mergeNew(
  saved: string[],
  incoming: string[],
  position: 'start' | 'end' = 'end'
): string[] {
  const known = new Set(saved)
  const added = [...new Set(incoming)].filter((id) => !known.has(id))
  if (!added.length) return saved
  return position === 'start' ? [...added, ...saved] : [...saved, ...added]
}

export function rememberSidebarSessions(sessions: (SavedSession | PiLiveSession)[]): void {
  const current = getSidebarOrder()
  const workspaces = mergeNew(
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
  // 首条消息提交后先使用会话 key 占位；pi 返回文件路径时在原位置替换，避免乱序。
  const aliases = new Map(
    sessions.flatMap((session) => ('key' in session ? [[session.key, session.path] as const] : []))
  )
  let changed = workspaces !== current.workspaces
  for (const [cwd, paths] of incoming) {
    const previous = current.sessions[cwd] ?? []
    const normalized = [...new Set(previous.map((path) => aliases.get(path) ?? path))]
    const next = mergeNew(normalized, paths, 'start')
    if (next.length !== previous.length || next.some((path, index) => path !== previous[index])) {
      nextSessions[cwd] = next
      changed = true
    }
  }
  if (changed) saveOrder({ workspaces, sessions: nextSessions })
}

export function reorderSidebarWorkspaces(ordered: string[]): void {
  const current = getSidebarOrder()
  saveOrder({ ...current, workspaces: mergeNew(ordered, current.workspaces) })
}

export function reorderSidebarSessions(cwd: string, ordered: string[]): void {
  const current = getSidebarOrder()
  saveOrder({
    ...current,
    sessions: {
      ...current.sessions,
      [cwd]: mergeNew(ordered, current.sessions[cwd] ?? [])
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
