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
import type { ToolApprovalMode, ToolApprovalRequest } from './tool-approval'
import type { UserQuestionAnswer, UserQuestionRequest } from './user-question'

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

/** 回复阶段由真实事件推进；内容块结束不代表整轮回复结束。 */
export type PiResponsePhase =
  'idle' | 'sending' | 'waiting' | 'thinking' | 'tool-call' | 'text' | 'tool-running'

export interface PiResponseState {
  id: number
  messageIndex: number
  phase: PiResponsePhase
  /** 只保留还在生成参数的调用，完整调用以消息中的 arguments 为准。 */
  toolCallDrafts: Record<string, string>
}

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
  response: PiResponseState
  tools: Record<string, PiToolEvent>
  toolApprovals: ToolApprovalRequest[]
  userQuestions: UserQuestionRequest[]
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
  approvalCount: number
  questionCount: number
}

export interface PiSnapshot extends PiSessionSnapshot {
  revision: number
  libraryVersion: number
  sessionKey: string
  liveSessions: PiLiveSession[]
  unavailableWorkspaces: string[]
  toolApprovalMode: ToolApprovalMode
}

export interface PiApi {
  connect(restart?: boolean): Promise<PiSnapshot>
  prompt(sessionKey: string, message: string, imagePaths?: string[]): Promise<void>
  compact(sessionKey: string, instructions?: string): Promise<void>
  editMessage(target: PiMessageTarget, message: string): Promise<void>
  forkMessage(target: PiMessageTarget): Promise<void>
  abort(sessionKey: string): Promise<void>
  respondToToolApproval(sessionKey: string, id: string, approved: boolean): Promise<void>
  respondToUserQuestion(
    sessionKey: string,
    id: string,
    answers: UserQuestionAnswer[]
  ): Promise<void>
  newSession(cwd?: string): Promise<void>
  openSession(path: string): Promise<void>
  deleteSession(path: string): Promise<void>
  getLibrary(): Promise<PiLibrary>
  getSkills(sessionKey: string): Promise<PiSkillCommand[]>
  getSettings(): Promise<PiSettingsSnapshot>
  saveSettings(changes: PiSettingsChange[]): Promise<PiSettingsSnapshot>
  readImage(source: string): Promise<string>
  chooseImages(language?: UiLanguage): Promise<string[]>
  saveImageData(bytes: Uint8Array): Promise<string>
  getImagePath(file: File): string
  setThinkingLevel(sessionKey: string, level: PiThinkingLevel): Promise<void>
  setModel(sessionKey: string, provider: string, modelId: string): Promise<void>
  chooseDirectory(language?: UiLanguage): Promise<string | undefined>
  onSnapshot(listener: (snapshot: PiSnapshot) => void): () => void
}

export const piChannels = {
  connect: 'pi:connect',
  prompt: 'pi:prompt',
  compact: 'pi:compact',
  editMessage: 'pi:edit-message',
  forkMessage: 'pi:fork-message',
  abort: 'pi:abort',
  respondToToolApproval: 'pi:respond-to-tool-approval',
  respondToUserQuestion: 'pi:respond-to-user-question',
  newSession: 'pi:new-session',
  openSession: 'pi:open-session',
  deleteSession: 'pi:delete-session',
  getLibrary: 'pi:get-library',
  getSkills: 'pi:get-skills',
  getSettings: 'pi:get-settings',
  saveSettings: 'pi:save-settings',
  readImage: 'pi:read-image',
  chooseImages: 'pi:choose-images',
  saveImageData: 'pi:save-image-data',
  setThinkingLevel: 'pi:set-thinking-level',
  setModel: 'pi:set-model',
  chooseDirectory: 'pi:choose-directory',
  snapshot: 'pi:snapshot'
} as const
