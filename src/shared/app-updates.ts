export interface AppUpdateSnapshot {
  revision: number
  currentVersion: string
  status: 'idle' | 'checking' | 'available' | 'up-to-date' | 'error'
  latestVersion: string | null
  error: string | null
}

export interface AppUpdatesApi {
  get(): Promise<AppUpdateSnapshot>
  check(): Promise<AppUpdateSnapshot>
  openRelease(): Promise<void>
  onSnapshot(listener: (snapshot: AppUpdateSnapshot) => void): () => void
}

export const appUpdatesChannels = {
  get: 'app-updates:get',
  check: 'app-updates:check',
  openRelease: 'app-updates:open-release',
  snapshot: 'app-updates:snapshot'
} as const
