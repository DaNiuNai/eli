import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
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
    this.validateWorkingDirectory(this.preferences)
    if (this.firstLaunch) await this.store.update(() => {})
  }

  get(): AppPreferences {
    return structuredClone(this.preferences)
  }

  set(value: unknown): Promise<void> {
    const next = parseAppPreferences(value)
    this.validateWorkingDirectory(next)
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

  private validateWorkingDirectory(preferences: AppPreferences): void {
    if (preferences.defaultWorkingDirectory && !isAbsolute(preferences.defaultWorkingDirectory)) {
      throw new Error('默认工作目录必须是绝对路径')
    }
  }
}
