import { randomUUID } from 'node:crypto'
import { createSettings } from './settings'
import { configureNetwork } from './network'
import type { AuthEvent, AuthPrompt, AuthType } from '@earendil-works/pi-ai'
import type { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { type AgentAuthSnapshot } from '../shared/agent-auth'

export class AgentAuthService {
  private snapshot: AgentAuthSnapshot
  private controller?: AbortController
  private operation?: Promise<void>
  private pending?: { id: string; resolve: (value: string) => void }
  private disposed = false

  constructor(
    private readonly root: string,
    private readonly changed: (snapshot: AgentAuthSnapshot) => void,
    firstLaunch: boolean,
    private readonly models: () => Promise<ModelRuntime>,
    private readonly authenticated: () => Promise<void>
  ) {
    this.snapshot = { revision: 0, firstLaunch, providers: [], status: 'idle' }
  }

  async get(): Promise<AgentAuthSnapshot> {
    this.publish()
    const runtime = await this.models()
    this.snapshot.providers = runtime
      .getProviders()
      .flatMap((provider) => {
        const configured = runtime.hasConfiguredAuth(provider.id)
        const options: AgentAuthSnapshot['providers'] = []
        if (provider.auth.oauth) {
          options.push({
            id: provider.id,
            name: provider.auth.oauth.name,
            type: 'oauth',
            configured
          })
        }
        if (provider.auth.apiKey?.login) {
          options.push({
            id: provider.id,
            name: provider.name,
            type: 'api_key',
            configured
          })
        }
        return options
      })
      .sort((a, b) => a.name.localeCompare(b.name))
    this.publish()
    return this.snapshot
  }

  async login(providerId: unknown, type: unknown): Promise<void> {
    if (typeof providerId !== 'string' || (type !== 'oauth' && type !== 'api_key')) {
      throw new Error('请选择有效的登录服务')
    }
    if (this.disposed) throw new Error('登录服务已关闭')
    if (this.operation) throw new Error('请先取消当前登录')
    const controller = new AbortController()
    this.controller = controller
    this.snapshot = {
      revision: this.snapshot.revision,
      firstLaunch: this.snapshot.firstLaunch,
      providers: this.snapshot.providers,
      status: 'logging-in',
      providerId
    }
    this.publish()
    // IPC 立即返回，后续步骤通过快照通知界面，输入通过独立 IPC 回传。
    this.operation = this.runLogin(providerId, type, controller).finally(() => {
      controller.abort()
      this.controller = undefined
      this.pending = undefined
      this.operation = undefined
    })
  }

  private async runLogin(
    providerId: string,
    type: AuthType,
    controller: AbortController
  ): Promise<void> {
    try {
      const runtime = await this.models()
      controller.signal.throwIfAborted()
      const provider = runtime.getProvider(providerId)
      const method = type === 'oauth' ? provider?.auth.oauth : provider?.auth.apiKey
      if (!method?.login) throw new Error('该服务不支持此登录方式')
      const settings = await createSettings(this.root)
      await configureNetwork(settings)
      await runtime.login(
        providerId,
        type,
        {
          signal: controller.signal,
          prompt: (prompt) => this.prompt(prompt, controller.signal),
          notify: (notice) => {
            if (this.disposed || controller.signal.aborted) return
            this.snapshot.notice = notice
            this.publish()
          }
        },
        { getDeviceId: () => settings.getOrCreateDeviceId() }
      )
      await settings.flush()
      await this.authenticated()
      this.snapshot.status = 'success'
      this.snapshot.firstLaunch = false
      this.snapshot.providers = this.snapshot.providers.map((provider) =>
        provider.id === providerId ? { ...provider, configured: true } : provider
      )
      this.snapshot.notice = undefined
      this.snapshot.prompt = undefined
    } catch (error) {
      this.snapshot.status = controller.signal.aborted ? 'idle' : 'error'
      this.snapshot.error = controller.signal.aborted
        ? undefined
        : error instanceof Error
          ? error.message
          : String(error)
      this.snapshot.prompt = undefined
      this.snapshot.notice = undefined
    }
    this.publish()
  }

  private prompt(prompt: AuthPrompt, loginSignal: AbortSignal): Promise<string> {
    const signal = prompt.signal ? AbortSignal.any([loginSignal, prompt.signal]) : loginSignal
    if (signal.aborted) return Promise.reject(new Error('登录已取消'))
    const id = randomUUID()
    return new Promise<string>((resolve, reject) => {
      const cleanup = (): void => {
        signal.removeEventListener('abort', cancel)
        if (this.pending?.id === id) {
          this.pending = undefined
          this.snapshot.prompt = undefined
          this.publish()
        }
      }
      const cancel = (): void => {
        cleanup()
        reject(new Error('登录已取消'))
      }
      this.pending = {
        id,
        resolve: (value) => {
          cleanup()
          resolve(value)
        }
      }
      this.snapshot.prompt =
        prompt.type === 'select'
          ? { id, type: prompt.type, message: prompt.message, options: prompt.options }
          : { id, type: prompt.type, message: prompt.message, placeholder: prompt.placeholder }
      signal.addEventListener('abort', cancel, { once: true })
      this.publish()
    })
  }

  respond(id: unknown, value: unknown): void {
    if (typeof id !== 'string' || typeof value !== 'string' || value.length > 32_768) {
      throw new Error('无效的登录输入')
    }
    const prompt = this.snapshot.prompt
    if (!prompt || this.pending?.id !== id) throw new Error('登录步骤已变化，请重试')
    if (prompt.type === 'select' && !prompt.options.some((option) => option.id === value)) {
      throw new Error('请选择有效的登录选项')
    }
    // pi 的部分文本输入允许留空，例如 GitHub Copilot 的默认域名。
    this.pending.resolve(value)
  }

  async cancel(): Promise<void> {
    this.controller?.abort()
    await this.operation
  }

  async validateLink(value: unknown): Promise<string> {
    const notice = this.snapshot.notice
    const links = notice ? this.noticeLinks(notice) : []
    if (typeof value !== 'string' || !links.includes(value)) throw new Error('无效的登录链接')
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('无效的登录链接')
    return url.href
  }

  private noticeLinks(notice: AuthEvent): string[] {
    if (notice.type === 'auth_url') return [notice.url]
    if (notice.type === 'device_code') return [notice.verificationUri]
    if (notice.type === 'info') return notice.links?.map((link) => link.url) ?? []
    return []
  }

  private publish(): void {
    this.snapshot.revision++
    if (!this.disposed) this.changed(this.snapshot)
  }

  async dispose(): Promise<void> {
    this.disposed = true
    await this.cancel()
  }
}
