import type {
  ContextUsage,
  JsonAgentSessionEvent,
  ModelInfo,
  RpcClient,
  RpcSessionState
} from '@earendil-works/pi-coding-agent'
import type { PiLibrary, SavedSession } from './pi-library'
import type { UiLanguage } from './app-preferences'
import type { PiSettingsChange, PiSettingsSnapshot } from './pi-settings'

// 消息、模型和 RPC 事件直接使用 pi 的类型，只定义桌面端的状态与 IPC 边界。
export type PiMessage = Awaited<ReturnType<RpcClient['getMessages']>>[number]
export type PiSkillCommand = Pick<
  Awaited<ReturnType<RpcClient['getCommands']>>[number],
  'name' | 'description'
>
export type PiThinkingLevel = RpcSessionState['thinkingLevel']
export type PiToolEvent = Extract<
  JsonAgentSessionEvent,
  { type: 'tool_execution_start' | 'tool_execution_update' | 'tool_execution_end' }
>

export interface PiMessageTarget {
  sessionId: string
  entryId: string
}

export interface PiSessionSnapshot {
  connection: 'connecting' | 'ready' | 'error'
  cwd: string
  session: Pick<
    RpcSessionState,
    'sessionId' | 'sessionFile' | 'sessionName' | 'thinkingLevel'
  > | null
  thinkingLevels: PiThinkingLevel[]
  contextUsage: ContextUsage | null
  model: ModelInfo | null
  models: ModelInfo[]
  messages: PiMessage[]
  messageEntryIds: (string | null)[]
  activeThinking: { messageIndex: number; contentIndex: number } | null
  tools: Record<string, PiToolEvent>
  running: boolean
  pending: boolean
  activity: string
  error: string | null
  hideThinkingBlock: boolean
}

export interface PiLiveSession extends SavedSession {
  key: string
  running: boolean
  pending: boolean
}

export interface PiSnapshot extends PiSessionSnapshot {
  revision: number
  libraryVersion: number
  sessionKey: string
  liveSessions: PiLiveSession[]
  unavailableWorkspaces: string[]
}

export interface PiApi {
  connect(restart?: boolean): Promise<PiSnapshot>
  prompt(sessionKey: string, message: string): Promise<void>
  editMessage(target: PiMessageTarget, message: string): Promise<void>
  forkMessage(target: PiMessageTarget): Promise<void>
  abort(sessionKey: string): Promise<void>
  newSession(cwd?: string): Promise<void>
  openSession(path: string): Promise<void>
  deleteSession(path: string): Promise<void>
  getLibrary(): Promise<PiLibrary>
  getSkills(sessionKey: string): Promise<PiSkillCommand[]>
  getSettings(): Promise<PiSettingsSnapshot>
  saveSettings(changes: PiSettingsChange[]): Promise<PiSettingsSnapshot>
  readImage(source: string): Promise<string>
  setThinkingLevel(sessionKey: string, level: PiThinkingLevel): Promise<void>
  setModel(sessionKey: string, provider: string, modelId: string): Promise<void>
  chooseDirectory(language?: UiLanguage): Promise<string | undefined>
  onSnapshot(listener: (snapshot: PiSnapshot) => void): () => void
}

export const piChannels = {
  connect: 'pi:connect',
  prompt: 'pi:prompt',
  editMessage: 'pi:edit-message',
  forkMessage: 'pi:fork-message',
  abort: 'pi:abort',
  newSession: 'pi:new-session',
  openSession: 'pi:open-session',
  deleteSession: 'pi:delete-session',
  getLibrary: 'pi:get-library',
  getSkills: 'pi:get-skills',
  getSettings: 'pi:get-settings',
  saveSettings: 'pi:save-settings',
  readImage: 'pi:read-image',
  setThinkingLevel: 'pi:set-thinking-level',
  setModel: 'pi:set-model',
  chooseDirectory: 'pi:choose-directory',
  snapshot: 'pi:snapshot'
} as const
