export type McpExposure = 'direct' | 'deferred' | 'codemode' | 'hidden'
interface McpBaseConfig {
  exposure?: McpExposure
  description?: string
  toolExposure?: Record<string, McpExposure>
  enabled?: boolean
  timeout?: number
}
export interface McpOAuthConfig {
  clientId?: string
  clientSecret?: string
  callbackPort?: number
  callbackUrl?: string
  scope?: string
  clientName?: string
  clientRegistration?: 'dcr' | 'cimd'
  authServerMetadataUrl?: string
}
export type McpServerConfig = McpBaseConfig &
  (
    | {
        type?: 'stdio'
        command: string
        args?: string[]
        env?: Record<string, string>
        cwd?: string
      }
    | {
        type?: 'http'
        url: string
        headers?: Record<string, string>
        oauth?: McpOAuthConfig
        auth?: { provider: string }
      }
  )

export interface McpServerDefinition {
  name: string
  config: McpServerConfig
}

export interface McpAuthenticationStatus {
  method: 'oauth' | 'manual' | 'provider' | 'local' | 'unknown'
  state:
    | 'authenticated'
    | 'configured'
    | 'unauthenticated'
    | 'expired'
    | 'needs-auth'
    | 'authorizing'
    | 'not-required'
    | 'external'
  canSignOut: boolean
  canReauthorize: boolean
}

export interface ManagedMcpServer extends McpServerDefinition {
  authentication: McpAuthenticationStatus
}

export type McpServerChange =
  | { action: 'create'; name: string; config: McpServerConfig }
  | { action: 'update'; name: string; config: McpServerConfig; expected: McpServerConfig }
  | { action: 'delete'; name: string; expected: McpServerConfig }
  | { action: 'setEnabled'; name: string; enabled: boolean }

export interface McpConnectionTest {
  status: 'connected' | 'needs-auth' | 'failed'
  message: string
  durationMs: number
  authentication?: { method: 'oauth' | 'manual' | 'unknown'; websiteUrl: string }
  tools: { name: string; description?: string; inputSchema: Record<string, unknown> }[]
}

export interface McpAuthSnapshot {
  revision: number
  status: 'idle' | 'authorizing' | 'success' | 'error' | 'signed-out'
  id?: string
  serverName?: string
  authorizationUrl?: string
  error?: string
  result?: McpConnectionTest
}

export interface McpAuthApi {
  get(): Promise<McpAuthSnapshot>
  start(name: string, force?: boolean): Promise<void>
  signOut(name: string): Promise<ManagedMcpServer[]>
  cancel(id: string): Promise<void>
  respond(id: string, redirectUrl: string): Promise<void>
  openLink(id: string): Promise<void>
  openWebsite(name: string): Promise<void>
  onSnapshot(listener: (snapshot: McpAuthSnapshot) => void): () => void
}

export const mcpAuthChannels = {
  get: 'mcp-auth:get',
  start: 'mcp-auth:start',
  signOut: 'mcp-auth:sign-out',
  cancel: 'mcp-auth:cancel',
  respond: 'mcp-auth:respond',
  openLink: 'mcp-auth:open-link',
  openWebsite: 'mcp-auth:open-website',
  snapshot: 'mcp-auth:snapshot'
} as const
