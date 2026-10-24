import type { McpServerConfig } from '@earendil-works/pi-coding-agent'

export type { McpServerConfig }

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
