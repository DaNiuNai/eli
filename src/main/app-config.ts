import { stat } from 'node:fs/promises'
import { EliConfigStore } from '../config/store'
import {
  defaultAppPreferences,
  parseAppPreferences,
  type AppPreferences
} from '../shared/app-preferences'

export class AppConfig {
  firstLaunch = false
  private preferences = defaultAppPreferences()
  private pending: Promise<void> = Promise.resolve()
  private readonly store: EliConfigStore

  constructor(path?: string) {
    this.store = new EliConfigStore(path)
  }

  get path(): string {
    return this.store.path
  }

  async load(): Promise<void> {
    this.firstLaunch = await stat(this.path).then(
      () => false,
      (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
        return true
      }
    )
    this.preferences = (await this.store.read()).app
    if (this.firstLaunch) await this.store.update(() => {})
  }

  get(): AppPreferences {
    return structuredClone(this.preferences)
  }

  set(value: unknown): Promise<void> {
    const next = parseAppPreferences(value)
    const writing = this.pending.then(async () => {
      await this.store.update((config) => {
        config.app = next
      })
      this.preferences = next
    })
    this.pending = writing.catch(() => {})
    return writing
  }

  flush(): Promise<void> {
    return this.pending
  }
}
