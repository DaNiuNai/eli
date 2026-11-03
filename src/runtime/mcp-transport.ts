import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  McpClient,
  StdioTransport,
  StreamableHttpTransport,
  McpAuthRequiredError,
  type AuthProvider,
  type Tool,
  type McpRequestOptions,
  type CallToolResult
} from '@earendil-works/pi-mcp'
import {
  authorizeMcp,
  McpOAuthProvider,
  OAuthCallbackServer,
  McpOAuthAuthorizationRequiredError,
  parseWwwAuthenticate,
  type OAuthChallenge,
  type McpOAuthState,
  type McpOAuthStateStore
} from '@earendil-works/pi-mcp/oauth'
import { JsonStore } from '../config/store'
import type { McpOAuthConfig, McpServerConfig, McpServerDefinition } from '../shared/mcp'

const { lock } = createRequire(import.meta.url)('proper-lockfile') as {
  lock(path: string, options: object): Promise<() => Promise<void>>
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const stringMap = (value: unknown): boolean =>
  record(value) && Object.values(value).every((item) => typeof item === 'string')
const exposures = ['direct', 'deferred', 'codemode', 'hidden']
export function mcpNamespace(name: string): string {
  return `mcp__${name.replaceAll('-', '_')}`
}

export function validateMcpServerConfig(_name: string, value: unknown): McpServerConfig | string {
  if (!record(value)) return '配置必须是对象'
  if (typeof value.enabled !== 'undefined' && typeof value.enabled !== 'boolean')
    return 'enabled 必须是布尔值'
  if (
    value.timeout !== undefined &&
    (typeof value.timeout !== 'number' || !Number.isFinite(value.timeout) || value.timeout <= 0)
  )
    return 'timeout 必须是正数'
  if (value.description !== undefined && typeof value.description !== 'string')
    return 'description 必须是字符串'
  if (value.exposure !== undefined && !exposures.includes(String(value.exposure)))
    return 'exposure 无效'
  if (
    value.toolExposure !== undefined &&
    (!record(value.toolExposure) ||
      !Object.values(value.toolExposure).every((item) => exposures.includes(String(item))))
  )
    return 'toolExposure 无效'
  if ('command' in value) {
    if (
      'url' in value ||
      (value.type !== undefined && value.type !== 'stdio') ||
      typeof value.command !== 'string' ||
      !value.command.trim()
    )
      return 'stdio 命令无效'
    if (
      value.args !== undefined &&
      (!Array.isArray(value.args) || !value.args.every((arg) => typeof arg === 'string'))
    )
      return 'args 必须是字符串数组'
    if (value.env !== undefined && !stringMap(value.env)) return 'env 必须是字符串映射'
    if (value.cwd !== undefined && typeof value.cwd !== 'string') return 'cwd 无效'
  } else {
    if (value.type !== undefined && value.type !== 'http') return 'HTTP 传输类型无效'
    if (typeof value.url !== 'string' || !URL.canParse(value.url)) return 'HTTP 地址无效'
    const url = new URL(value.url)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      return 'HTTP 地址无效'
    if (value.headers !== undefined && !stringMap(value.headers)) return 'headers 必须是字符串映射'
    if (
      value.auth !== undefined &&
      (!record(value.auth) ||
        typeof value.auth.provider !== 'string' ||
        !value.auth.provider.trim())
    )
      return 'auth.provider 无效'
    if (value.oauth !== undefined) {
      if (!record(value.oauth)) return 'oauth 必须是对象'
      for (const [key, item] of Object.entries(value.oauth)) {
        if (key === 'callbackPort') {
          if (!Number.isInteger(item) || Number(item) < 0 || Number(item) > 65535)
            return '回调端口无效'
        } else if (typeof item !== 'string') return `oauth.${key} 必须是字符串`
      }
      if (value.oauth.callbackUrl) {
        if (!URL.canParse(String(value.oauth.callbackUrl))) return '回调地址无效'
        const callback = new URL(String(value.oauth.callbackUrl))
        if (
          callback.protocol !== 'http:' ||
          !['127.0.0.1', 'localhost', '[::1]'].includes(callback.hostname) ||
          callback.username ||
          callback.password
        )
          return '回调必须使用本机 HTTP 地址'
      }
      if (
        value.oauth.clientRegistration !== undefined &&
        !['dcr', 'cimd'].includes(String(value.oauth.clientRegistration))
      )
        return '注册方式无效'
      if (
        value.oauth.authServerMetadataUrl &&
        (!URL.canParse(String(value.oauth.authServerMetadataUrl)) ||
          !['http:', 'https:'].includes(
            new URL(String(value.oauth.authServerMetadataUrl)).protocol
          ))
      )
        return 'OAuth 元数据地址无效'
    }
  }
  return JSON.parse(JSON.stringify(value))
}

interface ServerStore extends McpOAuthStateStore {
  withRefreshLock<T>(action: () => Promise<T>): Promise<T>
}
export class McpOAuthCredentialStore {
  private readonly store: JsonStore<Record<string, McpOAuthState>>
  constructor(
    path: string,
    private readonly lockDirectory: string
  ) {
    this.store = new JsonStore(path, (value) => {
      if (!record(value)) throw new Error('MCP 凭据格式无效')
      return value as Record<string, McpOAuthState>
    })
  }
  forServer(name: string, url: string): ServerStore {
    const legacyKey = new URL(url).href
    const key = `${mcpNamespace(name)}|${legacyKey}`
    return {
      load: async () => {
        const data = await this.store.read()
        if (data[key] || !data[legacyKey]) return data[key]
        return this.store.update((all) => {
          all[key] ??= all[legacyKey]
          delete all[legacyKey]
          return all[key]
        })
      },
      save: async (state) => {
        await this.store.update((data) => {
          data[key] = state
        })
      },
      withRefreshLock: async (action) => {
        await mkdir(this.lockDirectory, { recursive: true })
        let compromised: Error | undefined
        const release = await lock(
          join(this.lockDirectory, createHash('sha256').update(key).digest('hex')),
          {
            realpath: false,
            stale: 30000,
            retries: { retries: 60, minTimeout: 100, maxTimeout: 500 },
            onCompromised: (error: Error) => {
              compromised = error
            }
          }
        )
        try {
          const result = await action()
          if (compromised) throw compromised
          return result
        } finally {
          await release()
        }
      }
    }
  }
  async tokens(name: string, url: string): Promise<McpOAuthState['tokens']> {
    return (await this.forServer(name, url).load())?.tokens
  }
  async remove(name: string, url: string): Promise<void> {
    await this.store.update((data) => {
      delete data[`${mcpNamespace(name)}|${new URL(url).href}`]
      delete data[new URL(url).href]
    })
  }
}

export interface McpOAuthSettings extends Omit<McpOAuthConfig, 'authServerMetadataUrl'> {
  authServerMetadataUrl?: URL
}

function callbackId(serverUrl: string): string {
  const url = new URL(serverUrl)
  url.hash = ''
  return createHash('sha256').update(url.href).digest().subarray(0, 9).toString('base64url')
}

function oauthProvider(
  serverUrl: string,
  store: McpOAuthStateStore,
  settings: McpOAuthSettings,
  redirectUrl: string,
  onRedirect: (url: URL) => void
): McpOAuthProvider {
  return new McpOAuthProvider({
    serverUrl,
    store,
    redirectUrl,
    clientId: settings.clientId,
    clientSecret: settings.clientSecret,
    clientMetadata: { client_name: settings.clientName ?? 'eli' },
    clientMetadataDocument:
      settings.clientRegistration === 'cimd'
        ? (metadata) => {
            if (
              !metadata?.client_id_metadata_document_supported ||
              !metadata.token_endpoint_auth_methods_supported?.includes('none')
            )
              throw new Error('授权服务不支持公共客户端元数据文档')
            if (metadata.authorization_response_iss_parameter_supported)
              return { url: 'https://pi.dev/oauth/client.json', redirectUrl }
            const id = callbackId(serverUrl)
            const callback = new URL(redirectUrl)
            callback.pathname = `/callback/${id}`
            return { url: `https://pi.dev/oauth/${id}/client.json`, redirectUrl: callback.href }
          }
        : undefined,
    onRedirect
  })
}

export async function signInMcpServer(options: {
  serverUrl: string
  store: McpOAuthStateStore
  settings: McpOAuthSettings
  challenge?: OAuthChallenge
  signal?: AbortSignal
  prompt: {
    showAuthorizationUrl(url: URL): void
    promptForRedirectUrl(signal: AbortSignal): Promise<string | undefined>
  }
}): Promise<void> {
  options.signal?.throwIfAborted()
  const { settings, store, serverUrl } = options
  const stored = await store.load()
  const registered =
    stored?.clientInformation && 'redirect_uris' in stored.clientInformation
      ? stored.clientInformation.redirect_uris[0]
      : undefined
  const configured = new URL(settings.callbackUrl ?? 'http://127.0.0.1/callback')
  const fixedPort = configured.port ? Number(configured.port) : settings.callbackPort
  const preferredPort =
    fixedPort ?? (registered && URL.canParse(registered) ? Number(new URL(registered).port) : 0)
  const callbackOptions = {
    host:
      configured.hostname === 'localhost'
        ? '127.0.0.1'
        : configured.hostname.replace(/^\[|\]$/g, ''),
    redirectHost: configured.hostname,
    path: configured.pathname,
    extraPaths:
      settings.clientRegistration === 'cimd' ? [`/callback/${callbackId(serverUrl)}`] : [],
    port: preferredPort
  }
  const callback = await OAuthCallbackServer.listen(callbackOptions).catch((error: unknown) => {
    if (fixedPort !== undefined || (error as NodeJS.ErrnoException).code !== 'EADDRINUSE')
      throw error
    return OAuthCallbackServer.listen({ ...callbackOptions, port: 0 })
  })
  const controller = new AbortController()
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal
  try {
    const redirectUrl =
      settings.callbackUrl && configured.port ? settings.callbackUrl : callback.redirectUrl
    if (stored) {
      const next = { ...stored }
      delete next.oauthState
      if (
        !settings.clientId &&
        ((registered && registered !== redirectUrl) ||
          (settings.clientRegistration === 'cimd' && stored.clientInformation))
      ) {
        delete next.clientInformation
        delete next.tokens
        delete next.tokensExpireAt
      }
      await store.save(next)
    }
    let authorizationUrl: URL | undefined
    const provider = oauthProvider(serverUrl, store, settings, redirectUrl, (url) => {
      authorizationUrl = url
    })
    const flow = {
      serverUrl,
      signal,
      scope: settings.scope ?? options.challenge?.scope,
      resourceMetadataUrl: options.challenge?.resourceMetadataUrl,
      authorizationServerMetadataUrl: settings.authServerMetadataUrl
    }
    if ((await authorizeMcp(provider, flow)) === 'AUTHORIZED') return
    if (!authorizationUrl) throw new Error('MCP 未返回授权地址')
    const state = authorizationUrl.searchParams.get('state')
    const expected = new URL(authorizationUrl.searchParams.get('redirect_uri') ?? redirectUrl)
    if (!state) throw new Error('MCP 授权缺少 state')
    const abort = Promise.withResolvers<never>()
    const cancel = (): void => abort.reject(new Error('MCP_AUTH_CANCELLED'))
    signal.addEventListener('abort', cancel, { once: true })
    try {
      signal.throwIfAborted()
      options.prompt.showAuthorizationUrl(authorizationUrl)
      const pasted = options.prompt.promptForRedirectUrl(signal).then((value) => {
        if (!value) throw new Error('MCP_AUTH_CANCELLED')
        const url = new URL(value)
        if (
          url.origin !== expected.origin ||
          url.pathname !== expected.pathname ||
          url.searchParams.get('state') !== state
        )
          throw new Error('回调地址或 state 不匹配')
        const code = url.searchParams.get('code')
        if (!code || url.searchParams.has('error')) throw new Error('MCP 授权未成功')
        return { code, iss: url.searchParams.get('iss') ?? undefined }
      })
      const response = await Promise.race([
        callback.waitForCallback(state, expected.pathname),
        pasted,
        abort.promise
      ])
      signal.throwIfAborted()
      await authorizeMcp(provider, { ...flow, authorizationCode: response.code, iss: response.iss })
    } finally {
      signal.removeEventListener('abort', cancel)
    }
  } finally {
    controller.abort()
    await callback.close()
  }
}

export class McpServerConnection {
  readonly entry: McpServerDefinition
  state: 'connecting' | 'connected' | 'needs-auth' | 'failed' | 'closed' = 'connecting'
  tools: Tool[] = []
  challenge?: OAuthChallenge
  private client?: McpClient
  private opening?: Promise<McpClient>
  private refreshing?: Promise<void>
  private readonly shutdown = new AbortController()
  constructor(
    private readonly options: {
      entry: McpServerDefinition
      cwd: string
      credentials: McpOAuthCredentialStore
      providerToken?: (provider: string) => Promise<string | undefined>
      onTools?: () => void
    }
  ) {
    this.entry = options.entry
  }
  get oauthUrl(): string | undefined {
    return 'url' in this.entry.config ? this.entry.config.url : undefined
  }
  oauthSettings(): McpOAuthSettings {
    const config = 'url' in this.entry.config ? (this.entry.config.oauth ?? {}) : {}
    return {
      ...config,
      authServerMetadataUrl: config.authServerMetadataUrl
        ? new URL(config.authServerMetadataUrl)
        : undefined
    }
  }
  private authProvider(): AuthProvider | undefined {
    const config = this.entry.config
    if (
      !('url' in config) ||
      Object.keys(config.headers ?? {}).some((key) => key.toLowerCase() === 'authorization')
    )
      return undefined
    if (config.auth)
      return {
        token: async () => {
          const token = await this.options.providerToken?.(config.auth!.provider)
          if (!token) throw new McpOAuthAuthorizationRequiredError()
          return token
        }
      }
    const store = this.options.credentials.forServer(this.entry.name, config.url)
    const refresh = (stale: string | undefined): Promise<void> =>
      (this.refreshing ??= store
        .withRefreshLock(async () => {
          const state = await store.load()
          if (state?.tokens?.access_token !== stale) return
          if (!state?.tokens?.refresh_token) throw new McpOAuthAuthorizationRequiredError()
          const redirect =
            state.clientInformation && 'redirect_uris' in state.clientInformation
              ? state.clientInformation.redirect_uris[0]
              : undefined
          const provider = oauthProvider(
            config.url,
            store,
            this.oauthSettings(),
            redirect ?? 'http://127.0.0.1/callback',
            () => {
              throw new McpOAuthAuthorizationRequiredError()
            }
          )
          const result = await authorizeMcp(provider, {
            serverUrl: config.url,
            scope: this.challenge?.scope,
            resourceMetadataUrl: this.challenge?.resourceMetadataUrl,
            authorizationServerMetadataUrl: this.oauthSettings().authServerMetadataUrl,
            signal: AbortSignal.timeout(15000)
          })
          if (result !== 'AUTHORIZED') throw new McpOAuthAuthorizationRequiredError()
        })
        .finally(() => {
          this.refreshing = undefined
        }))
    return {
      token: async () => {
        const stored = await store.load()
        if (
          stored?.tokensExpireAt !== undefined &&
          stored.tokensExpireAt <= Date.now() + 30000 &&
          stored.tokens?.refresh_token
        )
          await refresh(stored.tokens.access_token)
        return (await store.load())?.tokens?.access_token
      },
      onUnauthorized: async ({ response, token }) => {
        this.challenge = parseWwwAuthenticate(response.headers.get('www-authenticate'))
        if (this.challenge.error === 'insufficient_scope')
          throw new McpOAuthAuthorizationRequiredError()
        await refresh(token)
      }
    }
  }
  getClient(): Promise<McpClient> {
    if (this.state === 'closed') return Promise.reject(new Error('MCP 连接已关闭'))
    if (this.client?.connectionState === 'connected') return Promise.resolve(this.client)
    this.opening ??= this.open().finally(() => {
      this.opening = undefined
    })
    return this.opening
  }
  private async open(): Promise<McpClient> {
    const config = this.entry.config
    const client = new McpClient({
      name: 'eli',
      version: '1',
      requestTimeoutMs: (config.timeout ?? 30) * 1000,
      roots: [{ uri: pathToFileURL(this.options.cwd).href }]
    })
    this.client = client
    const cancel = (): void => {
      void client.close()
    }
    this.shutdown.signal.addEventListener('abort', cancel, { once: true })
    try {
      const childEnvironment = { ...process.env }
      delete childEnvironment.ELECTRON_RUN_AS_NODE
      const transport =
        'url' in config
          ? new StreamableHttpTransport({
              url: config.url,
              headers: config.headers,
              authProvider: this.authProvider()
            })
          : new StdioTransport({
              command: config.command,
              args: config.args,
              env: {
                ...Object.fromEntries(
                  Object.entries(childEnvironment).filter(
                    (entry): entry is [string, string] => entry[1] !== undefined
                  )
                ),
                ...config.env
              },
              cwd: config.cwd ? resolve(this.options.cwd, config.cwd) : this.options.cwd,
              inheritEnv: false
            })
      await client.connect(transport)
      this.tools = await client.listTools({ signal: this.shutdown.signal })
      this.state = 'connected'
      this.options.onTools?.()
      return client
    } catch (error) {
      if (error instanceof McpAuthRequiredError)
        this.challenge = parseWwwAuthenticate(error.wwwAuthenticate)
      this.state =
        error instanceof McpAuthRequiredError || error instanceof McpOAuthAuthorizationRequiredError
          ? 'needs-auth'
          : 'failed'
      await client.close()
      throw error
    } finally {
      this.shutdown.signal.removeEventListener('abort', cancel)
    }
  }
  async callTool(
    name: string,
    args: Record<string, unknown>,
    options: McpRequestOptions
  ): Promise<CallToolResult> {
    return (await this.getClient()).callTool(name, args, options)
  }
  async reconnect(): Promise<void> {
    await this.client?.close()
    this.client = undefined
    this.state = 'connecting'
    await this.getClient()
  }
  async close(): Promise<void> {
    this.shutdown.abort()
    await this.client?.close()
    await this.opening?.catch(() => {})
    await this.refreshing?.catch(() => {})
    this.state = 'closed'
  }
}
