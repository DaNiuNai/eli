import type {
  JsonAgentSessionEvent,
  ModelInfo,
  RpcClient,
  RpcSessionState
} from '@earendil-works/pi-coding-agent'

// 消息、模型和 RPC 事件直接使用 pi 的类型，只定义桌面端的状态与 IPC 边界。
export type PiMessage = Awaited<ReturnType<RpcClient['getMessages']>>[number]
export type PiToolEvent = Extract<
  JsonAgentSessionEvent,
  { type: 'tool_execution_start' | 'tool_execution_update' | 'tool_execution_end' }
>

export interface PiSnapshot {
  revision: number
  connection: 'connecting' | 'ready' | 'error'
  cwd: string
  session: Pick<RpcSessionState, 'sessionId' | 'sessionName' | 'thinkingLevel'> | null
  model: ModelInfo | null
  models: ModelInfo[]
  messages: PiMessage[]
  tools: Record<string, PiToolEvent>
  running: boolean
  pending: boolean
  activity: string
  error: string | null
}

export interface PiApi {
  connect(restart?: boolean): Promise<PiSnapshot>
  prompt(message: string): Promise<void>
  abort(): Promise<void>
  newSession(): Promise<void>
  setModel(provider: string, modelId: string): Promise<void>
  chooseDirectory(): Promise<void>
  onSnapshot(listener: (snapshot: PiSnapshot) => void): () => void
}

export const piChannels = {
  connect: 'pi:connect',
  prompt: 'pi:prompt',
  abort: 'pi:abort',
  newSession: 'pi:new-session',
  setModel: 'pi:set-model',
  chooseDirectory: 'pi:choose-directory',
  snapshot: 'pi:snapshot'
} as const
