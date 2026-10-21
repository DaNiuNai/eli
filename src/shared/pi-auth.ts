import type { AuthEvent, AuthPrompt, AuthType } from '@earendil-works/pi-ai'

export interface PiLoginProvider {
  id: string
  name: string
  type: AuthType
  configured: boolean
}

// AbortSignal 留在主进程，跨 IPC 只传递展示所需的数据。
type SerializablePrompt<T> = T extends AuthPrompt ? Omit<T, 'signal'> : never
export type PiLoginPrompt = SerializablePrompt<AuthPrompt> & { id: string }

export interface PiAuthSnapshot {
  revision: number
  firstLaunch: boolean
  providers: PiLoginProvider[]
  status: 'idle' | 'logging-in' | 'success' | 'error'
  providerId?: string
  notice?: AuthEvent
  prompt?: PiLoginPrompt
  error?: string
}

export interface PiAuthApi {
  get(): Promise<PiAuthSnapshot>
  login(providerId: string, type: AuthType): Promise<void>
  respond(promptId: string, value: string): Promise<void>
  cancel(): Promise<void>
  openLink(url: string): Promise<void>
  onSnapshot(listener: (snapshot: PiAuthSnapshot) => void): () => void
}

export const piAuthChannels = {
  get: 'pi-auth:get',
  login: 'pi-auth:login',
  respond: 'pi-auth:respond',
  cancel: 'pi-auth:cancel',
  openLink: 'pi-auth:open-link',
  snapshot: 'pi-auth:snapshot'
} as const
