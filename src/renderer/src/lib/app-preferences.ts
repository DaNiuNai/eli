import { defaultAppPreferences, type AppPreferences } from '../../../shared/app-preferences'

const listeners = new Set<() => void>()
let preferences = defaultAppPreferences()
let saveError: string | null = null
let revision = 0

function publish(): void {
  for (const listener of listeners) listener()
}

export async function loadAppPreferences(): Promise<void> {
  preferences = await window.appPreferences.get()
  publish()
}

export function getAppPreferences(): AppPreferences {
  return preferences
}

export function getAppPreferencesError(): string | null {
  return saveError
}

export function subscribeAppPreferences(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function updateAppPreferences(patch: Partial<AppPreferences>): Promise<boolean> {
  const next = { ...preferences, ...patch }
  preferences = next
  const currentRevision = ++revision
  publish()

  // 每次提交完整快照；后续保存成功时也会包含此前尚未保存的改动。
  return window.appPreferences.set(next).then(
    () => {
      if (currentRevision !== revision) return true
      saveError = null
      publish()
      return true
    },
    (cause: unknown) => {
      if (currentRevision !== revision) return false
      saveError = cause instanceof Error ? cause.message : String(cause)
      publish()
      return false
    }
  )
}
