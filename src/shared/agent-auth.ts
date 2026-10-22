import type { AuthEvent, AuthPrompt, AuthType } from '@earendil-works/pi-ai'

export interface AgentLoginProvider {
  id: string
  name: string
  type: AuthType
  configured: boolean
}

// AbortSignal 留在 Runtime，跨 IPC 只传递展示所需的数据。
type SerializablePrompt<T> = T extends AuthPrompt ? Omit<T, 'signal'> : never
export type AgentLoginPrompt = SerializablePrompt<AuthPrompt> & { id: string }

export interface AgentAuthSnapshot {
  revision: number
  firstLaunch: boolean
  providers: AgentLoginProvider[]
  status: 'idle' | 'logging-in' | 'success' | 'error'
  providerId?: string
  notice?: AuthEvent
  prompt?: AgentLoginPrompt
  error?: string
}

export interface AgentAuthApi {
  get(): Promise<AgentAuthSnapshot>
  login(providerId: string, type: AuthType): Promise<void>
  respond(promptId: string, value: string): Promise<void>
  cancel(): Promise<void>
  openLink(url: string): Promise<void>
  onSnapshot(listener: (snapshot: AgentAuthSnapshot) => void): () => void
}

export const agentAuthChannels = {
  get: 'agent-auth:get',
  login: 'agent-auth:login',
  respond: 'agent-auth:respond',
  cancel: 'agent-auth:cancel',
  openLink: 'agent-auth:open-link',
  snapshot: 'agent-auth:snapshot'
} as const
