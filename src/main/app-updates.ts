import { gt, parse } from 'semver'
import type { AppUpdateSnapshot } from '../shared/app-updates'

const repository = 'DaNiuNai/eli'
const latestReleaseUrl = `https://api.github.com/repos/${repository}/releases/latest`

interface AppUpdatesOptions {
  currentVersion: string
  fetch: (url: string, init: RequestInit) => Promise<Response>
  openExternal: (url: string) => Promise<void>
  publish: (snapshot: AppUpdateSnapshot) => void
  timeoutMs?: number
}

class UpdateCheckError extends Error {}

export class AppUpdates {
  private snapshot: AppUpdateSnapshot
  private pending: Promise<AppUpdateSnapshot> | null = null
  private releaseTag: string | null = null

  constructor(private readonly options: AppUpdatesOptions) {
    this.snapshot = {
      revision: 0,
      currentVersion: options.currentVersion,
      status: 'idle',
      latestVersion: null,
      error: null
    }
  }

  get(): AppUpdateSnapshot {
    return { ...this.snapshot }
  }

  check(): Promise<AppUpdateSnapshot> {
    if (!this.pending) {
      this.pending = this.checkLatest().finally(() => {
        this.pending = null
      })
    }
    return this.pending
  }

  async openRelease(): Promise<void> {
    if (this.snapshot.status !== 'available' || !this.releaseTag) {
      throw new Error('请先检查更新。')
    }
    // 发行页固定在项目仓库中，不接受渲染进程或远端响应提供的任意 URL。
    await this.options.openExternal(
      `https://github.com/${repository}/releases/tag/${encodeURIComponent(this.releaseTag)}`
    )
  }

  private update(changes: Partial<AppUpdateSnapshot>): AppUpdateSnapshot {
    this.snapshot = { ...this.snapshot, ...changes, revision: this.snapshot.revision + 1 }
    this.options.publish(this.get())
    return this.get()
  }

  private async checkLatest(): Promise<AppUpdateSnapshot> {
    this.releaseTag = null
    this.update({ status: 'checking', latestVersion: null, error: null })
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 15_000)
    try {
      const response = await this.options.fetch(latestReleaseUrl, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `eli/${this.snapshot.currentVersion}`
        },
        cache: 'no-store',
        credentials: 'omit',
        signal: controller.signal
      })
      if (response.status === 404) throw new UpdateCheckError('暂时没有可用的正式版本。')
      if (response.status === 403 || response.status === 429) {
        throw new UpdateCheckError('更新服务暂时限制了请求，请稍后重试。')
      }
      if (!response.ok) throw new UpdateCheckError('更新服务暂时不可用，请稍后重试。')
      const data: unknown = await response.json()
      if (
        !data ||
        typeof data !== 'object' ||
        !('tag_name' in data) ||
        typeof data.tag_name !== 'string' ||
        !('draft' in data) ||
        data.draft !== false ||
        !('prerelease' in data) ||
        data.prerelease !== false
      ) {
        throw new UpdateCheckError('更新服务返回了无效的版本信息。')
      }
      const latest = parse(data.tag_name)
      const current = parse(this.snapshot.currentVersion)
      if (!latest || !current || latest.prerelease.length) {
        throw new UpdateCheckError('更新服务返回了无效的版本信息。')
      }
      const available = gt(latest, current)
      if (available) this.releaseTag = data.tag_name
      return this.update({
        status: available ? 'available' : 'up-to-date',
        latestVersion: latest.version
      })
    } catch (error) {
      return this.update({
        status: 'error',
        error: controller.signal.aborted
          ? '检查更新超时，请稍后重试。'
          : error instanceof UpdateCheckError
            ? error.message
            : error instanceof SyntaxError
              ? '更新服务返回了无效的版本信息。'
              : '无法连接更新服务，请检查网络后重试。'
      })
    } finally {
      clearTimeout(timeout)
    }
  }
}
