import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { discoverOAuthServerInfo, type McpOAuthState } from '@earendil-works/pi-mcp/oauth'
import { EliConfigStore } from '../config/store'
import type {
  ManagedMcpServer,
  McpAuthenticationStatus,
  McpAuthSnapshot,
  McpConnectionTest,
  McpServerConfig,
  McpServerDefinition
} from '../shared/mcp'
import { sdkMcpRuntime, sdkModules } from './sdk-adapter'
import { configureNetwork } from './network'
import { createSettings } from './settings'

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

type McpConnection = InstanceType<Awaited<ReturnType<typeof sdkMcpRuntime>>['McpServerConnection']>

function webUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !URL.canParse(value)) return undefined
  const url = new URL(value)
  return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
    ? url.href
    : undefined
}

export async function managedMcpServers(value: unknown): Promise<McpServerDefinition[]> {
  if (value === undefined) return []
  if (!record(value)) throw new Error('MCP 服务配置必须是对象')
  const sdk = await sdkModules()
  const namespaces = new Set<string>()
  return Object.entries(value).map(([name, raw]) => {
    if (!/^[a-zA-Z0-9_-]+$/.test(name))
      throw new Error('MCP 名称只能包含字母、数字、下划线和短横线')
    const config = sdk.validateMcpServerConfig(name, raw)
    if (typeof config === 'string') throw new Error(`MCP 配置无效：${config}`)
    // 避免 SDK 将同一个输入解释成两种传输。
    if (record(raw) && 'command' in raw && 'url' in raw) throw new Error('MCP 只能选择一种传输方式')
    if ('command' in config && !config.command.trim()) throw new Error('MCP 启动命令不能为空')
    const namespace = sdk.mcpNamespace(name)
    if (namespaces.has(namespace)) throw new Error('MCP 名称与已有服务的工具命名空间冲突')
    namespaces.add(namespace)
    return { name, config }
  })
}

/** 管理配置与聊天共享同一套 SDK 校验和传输；测试连接只发现工具，不执行工具。 */
export class McpService {
  private readonly store: EliConfigStore
  private readonly connections = new Set<McpConnection>()
  private readonly guides = new Map<string, { config: McpServerConfig; url: string }>()
  private readonly verified = new Map<
    string,
    { config: McpServerConfig; status: McpConnectionTest['status'] }
  >()
  private credentialOperation?: string
  private auth: McpAuthSnapshot = { revision: 0, status: 'idle' }
  private authController?: AbortController
  private authOperation?: Promise<void>
  private readonly shutdown = new AbortController()
  private redirectPrompt?: { id: string; resolve: (url: string) => void }
  private closed = false

  constructor(
    private readonly root: string,
    private readonly cwd: string,
    private readonly authChanged: (snapshot: McpAuthSnapshot) => void = () => {}
  ) {
    this.store = new EliConfigStore(join(root, 'config.json'))
  }

  async get(): Promise<ManagedMcpServer[]> {
    const servers = await managedMcpServers((await this.store.read()).mcpServers)
    return Promise.all(
      servers
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(async (server) => ({
          ...server,
          authentication: await this.authStatus(server)
        }))
    )
  }

  private async credentialStore(): Promise<
    InstanceType<Awaited<ReturnType<typeof sdkModules>>['McpOAuthCredentialStore']>
  > {
    const sdk = await sdkModules()
    return new sdk.McpOAuthCredentialStore(
      new sdk.FileAuthStorageBackend(join(this.root, 'mcp-auth.json')),
      join(this.root, 'mcp-locks')
    )
  }

  private async authStatus(server: McpServerDefinition): Promise<McpAuthenticationStatus> {
    const { config, name } = server
    if (!('url' in config))
      return { method: 'local', state: 'external', canSignOut: false, canReauthorize: false }
    const stored = await this.oauthState(name, config.url)
    const hasOAuth = !!stored?.tokens?.access_token
    const hasHeader = Object.entries(config.headers ?? {}).some(
      ([key, value]) => key.toLowerCase() === 'authorization' && !!value.trim()
    )
    const method = hasHeader
      ? 'manual'
      : config.auth
        ? 'provider'
        : hasOAuth || config.oauth || stored?.clientInformation
          ? 'oauth'
          : 'unknown'
    const canSignOut = hasHeader || !!config.auth || hasOAuth
    const canReauthorize = method !== 'provider'
    if (this.authOperation && this.auth.serverName === name)
      return { method, state: 'authorizing', canSignOut, canReauthorize }
    const probe = this.verified.get(name)
    const status = probe && isDeepStrictEqual(probe.config, config) ? probe.status : undefined
    const state: McpAuthenticationStatus['state'] =
      status === 'needs-auth'
        ? 'needs-auth'
        : hasHeader
          ? status === 'connected'
            ? 'authenticated'
            : 'configured'
          : config.auth
            ? 'external'
            : hasOAuth
              ? stored?.tokensExpireAt !== undefined && stored.tokensExpireAt <= Date.now()
                ? 'expired'
                : 'authenticated'
              : status === 'connected'
                ? 'not-required'
                : 'unauthenticated'
    return { method, state, canSignOut, canReauthorize }
  }

  private async oauthState(name: string, url: string): Promise<McpOAuthState | undefined> {
    try {
      return await (await this.credentialStore()).forServer(name, url).load()
    } catch {
      throw new Error('无法读取 MCP 认证信息，请检查认证文件。')
    }
  }

  async change(value: unknown): Promise<ManagedMcpServer[]> {
    if (!record(value) || typeof value.name !== 'string' || !value.name)
      throw new Error('无效的 MCP 管理操作')
    const { name, action } = value
    if (this.credentialOperation === name) throw new Error('MCP 认证正在更新，请稍后重试')
    if (this.authOperation && name === this.auth.serverName)
      throw new Error('请先完成或取消该 MCP 服务的授权')
    if (!/^[a-zA-Z0-9_-]+$/.test(name) || ['__proto__', 'constructor', 'prototype'].includes(name))
      throw new Error('无效的 MCP 服务名称')
    await this.store.update(async (config) => {
      const servers = { ...config.mcpServers }
      const existing = Object.hasOwn(servers, name) ? servers[name] : undefined
      if (action === 'create') {
        if (existing) throw new Error('MCP 名称已存在')
      } else if (action === 'update' || action === 'delete' || action === 'setEnabled') {
        if (!existing) throw new Error('MCP 服务不存在，请重新加载')
        if (action !== 'setEnabled' && !isDeepStrictEqual(existing, value.expected))
          throw new Error('MCP 配置已被其他操作修改，请重新加载')
      } else throw new Error('无效的 MCP 管理操作')
      if (action === 'delete') delete servers[name]
      else if (action === 'setEnabled') {
        if (typeof value.enabled !== 'boolean') throw new Error('无效的 MCP 开关设置')
        servers[name] = { ...existing!, enabled: value.enabled }
      } else servers[name] = value.config as McpServerConfig
      await managedMcpServers(servers)
      config.mcpServers = servers
    })
    this.guides.delete(name)
    this.verified.delete(name)
    if (this.auth.serverName === name) {
      this.auth = { revision: this.auth.revision, status: 'idle' }
      this.publishAuth()
    }
    return this.get()
  }

  private async connection(server: McpServerDefinition, cwd: string): Promise<McpConnection> {
    const [sdk, runtime] = await Promise.all([sdkModules(), sdkMcpRuntime()])
    if (this.closed) throw new Error('MCP 管理已关闭')
    return new runtime.McpServerConnection({
      entry: {
        ...server,
        config: { ...server.config, timeout: Math.min(server.config.timeout ?? 10, 10) },
        source: this.store.path,
        scope: 'global'
      },
      cwd,
      createTransport: runtime.createDefaultTransport,
      credentials: new sdk.McpOAuthCredentialStore(
        new sdk.FileAuthStorageBackend(join(this.root, 'mcp-auth.json')),
        join(this.root, 'mcp-locks')
      ),
      onTools: () => {}
    })
  }

  private connected(connection: McpConnection, started: number): McpConnectionTest {
    return {
      status: 'connected',
      message: 'MCP 连接成功',
      durationMs: Date.now() - started,
      tools: connection.tools.map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema
      }))
    }
  }

  private async authentication(
    connection: McpConnection
  ): Promise<NonNullable<McpConnectionTest['authentication']>> {
    const { config, name } = connection.entry
    if (!('url' in config)) throw new Error('本地 MCP 服务不支持浏览器授权')
    let websiteUrl = new URL(config.url).origin
    let method: 'oauth' | 'manual' | 'unknown' = 'unknown'
    try {
      const info = await discoverOAuthServerInfo(config.url, {
        resourceMetadataUrl: connection.challenge?.resourceMetadataUrl,
        authorizationServerMetadataUrl: connection.oauthSettings().authServerMetadataUrl,
        signal: AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(5000)])
      })
      websiteUrl =
        webUrl(info.resourceMetadata?.resource_documentation) ??
        webUrl(info.authorizationServerMetadata?.service_documentation) ??
        websiteUrl
      method = info.authorizationServerMetadata ? 'oauth' : 'manual'
    } catch {
      /* 暂时无法发现时保留浏览器授权重试入口。 */
    }
    if (!connection.oauthUrl) method = 'manual'
    this.guides.set(name, { config, url: websiteUrl })
    return { method, websiteUrl }
  }

  async test(name: unknown, cwd: unknown = this.cwd): Promise<McpConnectionTest> {
    if (this.closed) throw new Error('MCP 管理已关闭')
    if (this.authOperation) throw new Error('请先完成或取消 MCP 授权')
    if (this.credentialOperation) throw new Error('MCP 认证正在更新，请稍后重试')
    if (typeof name !== 'string') throw new Error('无效的 MCP 服务名称')
    if (typeof cwd !== 'string' || !cwd.trim()) throw new Error('无效的 MCP 测试工作目录')
    const server = (await this.get()).find((entry) => entry.name === name)
    if (!server) throw new Error('MCP 服务不存在，请重新加载')
    await configureNetwork(await createSettings(this.root))
    const connection = await this.connection(server, cwd)
    this.connections.add(connection)
    const started = Date.now()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        connection.getClient(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('MCP_TEST_TIMEOUT')), 15000)
        })
      ])
      this.verified.set(server.name, { config: server.config, status: 'connected' })
      return this.connected(connection, started)
    } catch (error) {
      const detail = error instanceof Error ? error.message : ''
      const needsAuth =
        connection.state === 'needs-auth' || /MCP server requires authentication/.test(detail)
      const authentication = needsAuth ? await this.authentication(connection) : undefined
      if (needsAuth) this.verified.set(server.name, { config: server.config, status: 'needs-auth' })
      return {
        status: needsAuth ? 'needs-auth' : 'failed',
        message: needsAuth
          ? 'MCP 服务需要认证，请选择浏览器授权或按服务商说明获取令牌。'
          : /timeout|timed out/i.test(detail)
            ? 'MCP 连接超时，请检查服务是否正常运行。'
            : /ENOENT/.test(detail)
              ? '找不到 MCP 启动命令或工作目录。'
              : 'MCP 连接失败，请检查地址、命令和认证配置。',
        durationMs: Date.now() - started,
        authentication,
        tools: []
      }
    } finally {
      clearTimeout(timer)
      await connection.close()
      this.connections.delete(connection)
    }
  }

  getAuth(): McpAuthSnapshot {
    return structuredClone(this.auth)
  }

  private publishAuth(): void {
    this.auth.revision++
    if (!this.closed) this.authChanged(this.getAuth())
  }

  async startAuth(name: unknown, force: unknown = false): Promise<void> {
    if (this.closed) throw new Error('MCP 管理已关闭')
    if (this.authOperation) throw new Error('请先完成或取消 MCP 授权')
    if (this.credentialOperation) throw new Error('MCP 认证正在更新，请稍后重试')
    if (typeof force !== 'boolean') throw new Error('无效的 MCP 重新授权操作')
    if (typeof name !== 'string') throw new Error('无效的 MCP 服务名称')
    const server = (await this.get()).find((entry) => entry.name === name)
    if (!server || !('url' in server.config)) throw new Error('请选择远程 HTTP MCP 服务')
    if (
      Object.keys(server.config.headers ?? {}).some(
        (key) => key.toLowerCase() === 'authorization'
      ) ||
      server.config.auth
    )
      throw new Error(
        '当前服务使用请求头或供应商认证，请先在编辑中移除该认证配置再使用浏览器授权。'
      )
    if (this.closed) throw new Error('MCP 管理已关闭')
    if (this.authOperation) throw new Error('请先完成或取消 MCP 授权')
    if (this.credentialOperation) throw new Error('MCP 认证正在更新，请稍后重试')
    if (force) {
      this.credentialOperation = name
      try {
        await this.clearOAuth(server, true)
      } finally {
        this.credentialOperation = undefined
      }
      this.verified.delete(name)
    }
    if (this.closed) throw new Error('MCP 管理已关闭')
    const controller = new AbortController()
    this.authController = controller
    this.auth = {
      revision: this.auth.revision,
      status: 'authorizing',
      id: randomUUID(),
      serverName: name
    }
    this.publishAuth()
    this.authOperation = this.runAuthorization(server, controller).finally(() => {
      controller.abort()
      this.redirectPrompt = undefined
      this.authController = undefined
      this.authOperation = undefined
    })
  }

  private async runAuthorization(
    server: McpServerDefinition,
    controller: AbortController
  ): Promise<void> {
    let connection: McpConnection | undefined
    const timer = setTimeout(() => controller.abort(new Error('MCP_AUTH_TIMEOUT')), 300000)
    const started = Date.now()
    try {
      await configureNetwork(await createSettings(this.root))
      controller.signal.throwIfAborted()
      connection = await this.connection(server, this.cwd)
      controller.signal.throwIfAborted()
      this.connections.add(connection)
      const current = connection
      const stop = (): void => {
        void current.close()
      }
      controller.signal.addEventListener('abort', stop, { once: true })
      try {
        await connection.getClient().catch((error: unknown) => {
          if (connection?.state !== 'needs-auth') throw error
        })
        controller.signal.throwIfAborted()
        if (connection.state !== 'connected') {
          const sdk = await sdkModules()
          if (!connection.oauthUrl) throw new Error('MCP_MANUAL_AUTH')
          await sdk.signInMcpServer({
            serverUrl: connection.oauthUrl,
            store: new sdk.McpOAuthCredentialStore(
              new sdk.FileAuthStorageBackend(join(this.root, 'mcp-auth.json')),
              join(this.root, 'mcp-locks')
            ).forServer(server.name, connection.oauthUrl),
            settings: {
              ...connection.oauthSettings(),
              clientName: connection.oauthSettings().clientName ?? 'eli'
            },
            challenge: connection.challenge,
            signal: controller.signal,
            prompt: {
              showAuthorizationUrl: (url) => {
                const link = webUrl(url.href)
                if (!link || controller.signal.aborted) throw new Error('无效的 MCP 授权链接')
                this.auth.authorizationUrl = link
                this.publishAuth()
              },
              promptForRedirectUrl: (signal) =>
                new Promise<string>((resolve, reject) => {
                  const cancel = (): void => {
                    this.redirectPrompt = undefined
                    reject(new Error('MCP_AUTH_CANCELLED'))
                  }
                  if (signal.aborted) {
                    cancel()
                    return
                  }
                  this.redirectPrompt = {
                    id: this.auth.id!,
                    resolve: (value) => {
                      signal.removeEventListener('abort', cancel)
                      this.redirectPrompt = undefined
                      resolve(value)
                    }
                  }
                  signal.addEventListener('abort', cancel, { once: true })
                })
            }
          })
          controller.signal.throwIfAborted()
          await connection.reconnect()
        }
        this.auth = {
          revision: this.auth.revision,
          id: this.auth.id,
          serverName: server.name,
          status: 'success',
          result: this.connected(connection, started)
        }
        this.verified.set(server.name, { config: server.config, status: 'connected' })
      } finally {
        controller.signal.removeEventListener('abort', stop)
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : ''
      const timedOut =
        controller.signal.reason instanceof Error &&
        controller.signal.reason.message === 'MCP_AUTH_TIMEOUT'
      this.auth = {
        revision: this.auth.revision,
        id: this.auth.id,
        serverName: server.name,
        status: controller.signal.aborted && !timedOut ? 'idle' : 'error',
        error:
          controller.signal.aborted && !timedOut
            ? undefined
            : timedOut
              ? 'MCP 授权等待超时，请重试。'
              : /does not support dynamic client registration|client.?id is required/i.test(detail)
                ? '服务要求预注册 OAuth 客户端，请按服务商文档配置客户端，或使用其提供的访问令牌。'
                : '浏览器授权未完成，请重试；若服务仅支持 API Key，请前往服务商控制台创建令牌。'
      }
    } finally {
      clearTimeout(timer)
      await connection?.close()
      if (connection) this.connections.delete(connection)
      this.publishAuth()
    }
  }

  private async clearOAuth(server: McpServerDefinition, tokensOnly = false): Promise<void> {
    if (!('url' in server.config)) return
    const url = server.config.url
    const store = await this.credentialStore()
    try {
      await store.forServer(server.name, url).withRefreshLock(async () => {
        if (!tokensOnly) {
          store.remove(server.name, url)
          return
        }
        const entry = store.forServer(server.name, url)
        const state = await entry.load()
        if (state) {
          const next = { ...state }
          delete next.tokens
          delete next.tokensExpireAt
          delete next.codeVerifier
          delete next.oauthState
          await entry.save(next)
        }
      })
    } catch {
      throw new Error('无法清除 MCP 认证信息，请重试。')
    }
  }

  async signOut(name: unknown): Promise<ManagedMcpServer[]> {
    if (this.closed) throw new Error('MCP 管理已关闭')
    if (typeof name !== 'string') throw new Error('无效的 MCP 服务名称')
    if (this.credentialOperation) throw new Error('MCP 认证正在更新，请稍后重试')
    this.credentialOperation = name
    try {
      const server = (await this.get()).find((entry) => entry.name === name)
      if (!server || !('url' in server.config)) throw new Error('请选择远程 HTTP MCP 服务')
      if (this.auth.serverName === name && this.authOperation) await this.cancelAuth(this.auth.id)
      await Promise.all(
        [...this.connections]
          .filter((connection) => connection.entry.name === name)
          .map((connection) => connection.close())
      )
      if (
        server.config.auth ||
        Object.keys(server.config.headers ?? {}).some(
          (key) => key.toLowerCase() === 'authorization'
        )
      ) {
        await this.store.update((config) => {
          const current = config.mcpServers?.[name]
          if (!current || !isDeepStrictEqual(current, server.config) || !('url' in current))
            throw new Error('MCP 配置已被其他操作修改，请重新加载')
          delete current.auth
          current.headers = Object.fromEntries(
            Object.entries(current.headers ?? {}).filter(
              ([key]) => key.toLowerCase() !== 'authorization'
            )
          )
        })
      }
      await this.clearOAuth(server)
      this.verified.delete(name)
      this.auth = { revision: this.auth.revision, status: 'signed-out', serverName: name }
      this.publishAuth()
      return await this.get()
    } finally {
      this.credentialOperation = undefined
    }
  }

  async cancelAuth(id: unknown): Promise<void> {
    if (typeof id !== 'string' || this.auth.id !== id) throw new Error('MCP 授权步骤已变化，请重试')
    this.authController?.abort()
    await this.authOperation
  }

  respondAuth(id: unknown, value: unknown): void {
    if (
      typeof id !== 'string' ||
      id !== this.auth.id ||
      this.redirectPrompt?.id !== id ||
      typeof value !== 'string' ||
      !value.trim() ||
      value.length > 32768
    )
      throw new Error('无效的 MCP 授权回调，请检查当前授权步骤')
    this.redirectPrompt.resolve(value)
  }

  validateAuthLink(id: unknown): string {
    if (
      typeof id !== 'string' ||
      this.auth.id !== id ||
      this.auth.status !== 'authorizing' ||
      !this.auth.authorizationUrl
    )
      throw new Error('MCP 授权链接已失效，请重新授权')
    return this.auth.authorizationUrl
  }

  async website(name: unknown): Promise<string> {
    const server = (await this.get()).find((entry) => entry.name === name)
    if (!server || !('url' in server.config)) throw new Error('请选择远程 HTTP MCP 服务')
    const guide = this.guides.get(server.name)
    const config = { ...server.config, timeout: Math.min(server.config.timeout ?? 10, 10) }
    return guide && isDeepStrictEqual(guide.config, config)
      ? guide.url
      : new URL(server.config.url).origin
  }

  async close(): Promise<void> {
    this.closed = true
    this.shutdown.abort()
    this.authController?.abort()
    await Promise.allSettled([...this.connections].map((connection) => connection.close()))
    await this.authOperation
  }
}
