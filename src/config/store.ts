import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { parseEliConfig, type EliConfig } from './schema'

const { lock } = createRequire(import.meta.url)('proper-lockfile') as {
  lock(
    path: string,
    options: {
      realpath: boolean
      stale: number
      retries: { retries: number; minTimeout: number; maxTimeout: number }
      onCompromised: (error: Error) => void
    }
  ): Promise<() => Promise<void>>
}

/** 所有进程按字段更新同一文档，独立于 SDK 存储，并以原子替换避免半写入。 */
export class EliConfigStore {
  constructor(readonly path = join(homedir(), '.eli', 'config.json')) {}

  async read(): Promise<EliConfig> {
    try {
      return parseEliConfig(JSON.parse((await readFile(this.path, 'utf8')).replace(/^\uFEFF/, '')))
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return parseEliConfig({})
      // 不把原始 JSON 内容或凭据包含在错误消息中。
      throw new Error(`无法读取 Eli 配置，请检查 ${this.path}`, { cause })
    }
  }

  async update<T>(change: (config: EliConfig) => T | Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted()
    await mkdir(dirname(this.path), { recursive: true })
    let compromised: Error | undefined
    let release: (() => Promise<void>) | undefined
    // Windows 上已释放的锁目录可能仍被索引服务占用。
    for (let attempt = 0; !release; attempt++) {
      try {
        release = await lock(this.path, {
          realpath: false,
          stale: 30000,
          retries: { retries: 30, minTimeout: 25, maxTimeout: 500 },
          onCompromised: (error) => {
            compromised = error
          }
        })
      } catch (error) {
        if (
          process.platform !== 'win32' ||
          (error as NodeJS.ErrnoException).code !== 'EPERM' ||
          attempt === 5
        )
          throw error
        await delay(25 * 2 ** attempt)
      }
    }
    try {
      signal?.throwIfAborted()
      const config = await this.read()
      const result = await change(config)
      signal?.throwIfAborted()
      if (compromised) throw compromised
      await this.write(parseEliConfig(config))
      return result
    } finally {
      await release()
    }
  }

  private async write(config: EliConfig): Promise<void> {
    const temporaryPath = `${this.path}.${randomUUID()}.tmp`
    try {
      await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600
      })
      for (let attempt = 0; ; attempt++) {
        try {
          await rename(temporaryPath, this.path)
          break
        } catch (error) {
          if (
            process.platform !== 'win32' ||
            !['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '') ||
            attempt === 5
          )
            throw error
          await delay(25 * 2 ** attempt)
        }
      }
    } catch (cause) {
      await rm(temporaryPath, { force: true }).catch(() => {})
      throw new Error(`无法保存 Eli 配置 ${this.path}`, { cause })
    }
  }
}
