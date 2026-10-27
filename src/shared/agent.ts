import type { ContextUsage, AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import type { AgentLibrary, SavedSession } from './agent-library'
import type { UiLanguage } from './app-preferences'
import type { AgentSettingsChange, AgentSettingsSnapshot } from './agent-settings'
import type { ManagedMcpServer, McpConnectionTest, McpServerChange } from './mcp'
import type { AutoApprovalState, ToolApprovalMode, ToolApprovalRequest } from './tool-approval'
import type { UserQuestionAnswer, UserQuestionRequest } from './user-question'
import type { CommonSkillsInstallResult, UserSkill } from './skills'
import type { BackgroundTask } from './background-tasks'
import type { SubagentAction, SubagentSnapshot } from './subagents'

// 应用协议与 SDK 的 CLI / RPC 类型无关；消息内容复用引擎的会话类型。
export type AgentMessage = AgentSession['messages'][number]
export interface AgentSkillCommand {
  name: string
  description: string
}
export type AgentThinkingLevel = AgentSession['thinkingLevel']
export interface AgentModelInfo {
  provider: string
  id: string
  contextWindow: number
  reasoning: boolean
}
export interface AgentSessionInfo {
  sessionId: string
  sessionFile?: string
  sessionName?: string
  thinkingLevel: AgentThinkingLevel
}
export type AgentToolEvent = Extract<
  AgentSessionEvent,
  { type: 'tool_execution_start' | 'tool_execution_update' | 'tool_execution_end' }
>

/** 回复阶段由真实事件推进；内容块结束不代表整轮回复结束。 */
export type AgentResponsePhase =
  'idle' | 'sending' | 'waiting' | 'thinking' | 'tool-call' | 'text' | 'tool-running'

export interface AgentResponseState {
  id: number
  messageIndex: number
  phase: AgentResponsePhase
  /** 只保留还在生成参数的调用，完整调用以消息中的 arguments 为准。 */
  toolCallDrafts: Record<string, string>
}

export interface AgentMessageTarget {
  sessionId: string
  entryId: string
}

export interface AgentSessionSnapshot {
  connection: 'connecting' | 'ready' | 'error'
  cwd: string
  session: AgentSessionInfo | null
  thinkingLevels: AgentThinkingLevel[]
  contextUsage: ContextUsage | null
  model: AgentModelInfo | null
  models: AgentModelInfo[]
  messages: AgentMessage[]
  messageEntryIds: (string | null)[]
  activeThinking: { messageIndex: number; contentIndex: number } | null
  response: AgentResponseState
  tools: Record<string, AgentToolEvent>
  backgroundTasks: BackgroundTask[]
  subagents: SubagentSnapshot[]
  toolApprovals: ToolApprovalRequest[]
  autoApproval: AutoApprovalState
  userQuestions: UserQuestionRequest[]
  running: boolean
  pending: boolean
  activity: string
  error: string | null
  hideThinkingBlock: boolean
}

export interface AgentLiveSession extends SavedSession {
  key: string
  running: boolean
  pending: boolean
  approvalCount: number
  questionCount: number
  backgroundTaskCount: number
  subagentCount: number
}

export interface AgentSnapshot extends AgentSessionSnapshot {
  revision: number
  libraryVersion: number
  sessionKey: string
  liveSessions: AgentLiveSession[]
  unavailableWorkspaces: string[]
  toolApprovalMode: ToolApprovalMode
}

export interface AgentApi {
  connect(restart?: boolean): Promise<AgentSnapshot>
  prompt(sessionKey: string, message: string, attachmentPaths?: string[]): Promise<void>
  compact(sessionKey: string, instructions?: string): Promise<void>
  editMessage(target: AgentMessageTarget, message: string): Promise<void>
  forkMessage(target: AgentMessageTarget): Promise<void>
  abort(sessionKey: string): Promise<void>
  stopBackgroundTask(sessionKey: string, id: string): Promise<void>
  controlSubagent(sessionKey: string, action: SubagentAction): Promise<void>
  respondToToolApproval(sessionKey: string, id: string, approved: boolean): Promise<void>
  respondToUserQuestion(
    sessionKey: string,
    id: string,
    answers: UserQuestionAnswer[]
  ): Promise<void>
  newSession(cwd?: string): Promise<void>
  openSession(path: string): Promise<void>
  deleteSession(path: string): Promise<void>
  getLibrary(): Promise<AgentLibrary>
  getSkills(sessionKey: string): Promise<AgentSkillCommand[]>
  getUserSkills(): Promise<UserSkill[]>
  installCommonSkills(): Promise<CommonSkillsInstallResult>
  getMcpServers(): Promise<ManagedMcpServer[]>
  changeMcpServer(change: McpServerChange): Promise<ManagedMcpServer[]>
  testMcpServer(name: string): Promise<McpConnectionTest>
  setSkillEnabled(filePath: string, enabled: boolean): Promise<UserSkill[]>
  getSettings(): Promise<AgentSettingsSnapshot>
  saveSettings(changes: AgentSettingsChange[]): Promise<AgentSettingsSnapshot>
  readImage(source: string): Promise<string>
  chooseFiles(language?: UiLanguage): Promise<string[]>
  saveImageData(bytes: Uint8Array): Promise<string>
  saveFileData(name: string, bytes: Uint8Array): Promise<string>
  getFilePath(file: File): string
  setThinkingLevel(sessionKey: string, level: AgentThinkingLevel): Promise<void>
  setModel(sessionKey: string, provider: string, modelId: string): Promise<void>
  chooseDirectory(language?: UiLanguage): Promise<string | undefined>
  onSnapshot(listener: (snapshot: AgentSnapshot) => void): () => void
}

export const agentChannels = {
  connect: 'agent:connect',
  prompt: 'agent:prompt',
  compact: 'agent:compact',
  editMessage: 'agent:edit-message',
  forkMessage: 'agent:fork-message',
  abort: 'agent:abort',
  stopBackgroundTask: 'agent:stop-background-task',
  controlSubagent: 'agent:control-subagent',
  respondToToolApproval: 'agent:respond-to-tool-approval',
  respondToUserQuestion: 'agent:respond-to-user-question',
  newSession: 'agent:new-session',
  openSession: 'agent:open-session',
  deleteSession: 'agent:delete-session',
  getLibrary: 'agent:get-library',
  getSkills: 'agent:get-skills',
  getUserSkills: 'agent:get-user-skills',
  installCommonSkills: 'agent:install-common-skills',
  getMcpServers: 'agent:get-mcp-servers',
  changeMcpServer: 'agent:change-mcp-server',
  testMcpServer: 'agent:test-mcp-server',
  setSkillEnabled: 'agent:set-skill-enabled',
  getSettings: 'agent:get-settings',
  saveSettings: 'agent:save-settings',
  readImage: 'agent:read-image',
  chooseFiles: 'agent:choose-files',
  saveImageData: 'agent:save-image-data',
  saveFileData: 'agent:save-file-data',
  setThinkingLevel: 'agent:set-thinking-level',
  setModel: 'agent:set-model',
  chooseDirectory: 'agent:choose-directory',
  snapshot: 'agent:snapshot'
} as const
