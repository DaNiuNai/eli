import { getAppPreferences, updateAppPreferences } from './app-preferences'

export function workspacePathKey(cwd: string): string {
  const path = cwd.replace(/\\/g, '/')
  const normalized = path.length > 1 ? path.replace(/\/+$/, '') : path
  return /^[a-z]:(?:\/|$)/i.test(normalized) || normalized.startsWith('//')
    ? normalized.toLowerCase()
    : normalized
}

export function archiveWorkspace(cwd: string): void {
  const { archivedWorkspaces } = getAppPreferences()
  const key = workspacePathKey(cwd)
  if (archivedWorkspaces.some((path) => workspacePathKey(path) === key)) return
  updateAppPreferences({ archivedWorkspaces: [...archivedWorkspaces, cwd] })
}

export function restoreWorkspace(cwd: string): void {
  const { archivedWorkspaces } = getAppPreferences()
  const key = workspacePathKey(cwd)
  const next = archivedWorkspaces.filter((path) => workspacePathKey(path) !== key)
  if (next.length !== archivedWorkspaces.length) {
    updateAppPreferences({ archivedWorkspaces: next })
  }
}
