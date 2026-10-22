import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import {
  defaultAppPreferences,
  parseAppPreferences,
  type AppPreferences
} from '../shared/app-preferences'

export class AppConfig {
  firstLaunch = false
  private preferences = defaultAppPreferences()
  private pending: Promise<void> = Promise.resolve()

  constructor(readonly path = join(homedir(), '.eli', 'config.json')) {}

  async load(): Promise<void> {
    // Electron profile 可能已创建 ~/.eli；以应用配置文件判断首次启动。
    this.firstLaunch = await stat(this.path).then(
      () => false,
      (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
        return true
      }
    )
    let content: string
    try {
      content = await readFile(this.path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await this.set(defaultAppPreferences())
      return
    }

    try {
      this.preferences = parseAppPreferences(JSON.parse(content.replace(/^\uFEFF/, '')))
    } catch (cause) {
      throw new Error(`请检查配置文件 ${this.path}\n${String(cause)}`, { cause })
    }
  }

  get(): AppPreferences {
    return this.preferences
  }

  set(value: unknown): Promise<void> {
    const next = parseAppPreferences(value)
    // 在主进程中排队，避免快速切换设置时旧写入覆盖新写入。
    const writing = this.pending.then(async () => {
      await this.write(next)
      this.preferences = next
    })
    this.pending = writing.catch(() => {})
    return writing
  }

  flush(): Promise<void> {
    return this.pending
  }

  private async write(preferences: AppPreferences): Promise<void> {
    const temporaryPath = `${this.path}.${randomUUID()}.tmp`
    try {
      await mkdir(dirname(this.path), { recursive: true })
      await writeFile(temporaryPath, `${JSON.stringify(preferences, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600
      })
      await this.replace(temporaryPath)
    } catch (cause) {
      await rm(temporaryPath, { force: true }).catch(() => {})
      throw new Error(`无法保存配置文件 ${this.path}\n${String(cause)}`, { cause })
    }
  }

  private async replace(temporaryPath: string): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(temporaryPath, this.path)
        return
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        // Windows 的文件索引或杀毒扫描可能短暂占用新写入的文件。
        if (
          process.platform !== 'win32' ||
          !['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '') ||
          attempt === 5
        ) {
          throw error
        }
        await delay(25 * 2 ** attempt)
      }
    }
  }
}
