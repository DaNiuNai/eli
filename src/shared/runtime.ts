import type {
  AgentLiveSession,
  AgentSessionSnapshot,
  AgentThinkingLevel,
  AgentSkillCommand,
  AgentMessageTarget
} from './agent'
import type { AgentAuthSnapshot } from './agent-auth'
import type { AgentLibrary, SavedSession } from './agent-library'
import type { AgentSettingsSnapshot, AgentSettingsChange } from './agent-settings'
import type { ToolApprovalMode } from './tool-approval'
import type { TerminalPreference } from './terminal'
import type { UserQuestionAnswer } from './user-question'
import type { ProviderChange, ProvidersSnapshot } from './providers'
import type { UserSkill } from './skills'

export const runtimeProtocolVersion = 1
export const mainAgentId = 'main'

export type RuntimeInit = {
  root: string
  cwd: string
} & (
  | { kind: 'control'; firstLaunch: boolean }
  | {
      kind: 'session'
      sessionKey: string
      sessionFile?: string
      approvalMode: ToolApprovalMode
      terminal: TerminalPreference
      selection?: { provider: string; modelId: string; thinkingLevel: AgentThinkingLevel }
    }
)

export interface RuntimeSessionState {
  snapshot: AgentSessionSnapshot
  summary: AgentLiveSession | null
  persistedFile?: string
}

/** 应用自有协议。agentId 是团队成员的路由边界，本次只开放 main。 */
export interface RuntimeMethods {
  getProviders: { args: []; result: ProvidersSnapshot }
  changeProvider: { args: [ProviderChange]; result: ProvidersSnapshot }
  initialize: { args: [RuntimeInit]; result: RuntimeSessionState | null }
  shutdown: { args: []; result: void }
  prompt: { args: [string]; result: RuntimeSessionState }
  compact: { args: [string?]; result: RuntimeSessionState }
  abort: { args: []; result: RuntimeSessionState }
  setModel: { args: [string, string]; result: RuntimeSessionState }
  setThinkingLevel: { args: [AgentThinkingLevel]; result: RuntimeSessionState }
  editMessage: { args: [AgentMessageTarget, string]; result: RuntimeSessionState }
  forkMessage: { args: [AgentMessageTarget]; result: string }
  getSkills: { args: []; result: AgentSkillCommand[] }
  getUserSkills: { args: []; result: UserSkill[] }
  setSkillEnabled: { args: [string, boolean]; result: UserSkill[] }
  configure: { args: [ToolApprovalMode]; result: void }
  approve: { args: [string, boolean]; result: void }
  answer: { args: [string, UserQuestionAnswer[]]; result: void }
  getLibrary: { args: [number?]; result: AgentLibrary }
  findSession: { args: [string]; result: SavedSession }
  hasWorkspace: { args: [string]; result: boolean }
  getSettings: { args: []; result: AgentSettingsSnapshot }
  saveSettings: { args: [AgentSettingsChange[]]; result: AgentSettingsSnapshot }
  getAuth: { args: []; result: AgentAuthSnapshot }
  login: { args: [string, 'oauth' | 'api_key']; result: void }
  respondLogin: { args: [string, string]; result: void }
  cancelLogin: { args: []; result: void }
  validateAuthLink: { args: [string]; result: string }
}
export type RuntimeMethod = keyof RuntimeMethods
export type RuntimeRequest = {
  [K in RuntimeMethod]: {
    version: typeof runtimeProtocolVersion
    kind: 'request'
    id: string
    agentId: string
    method: K
    args: RuntimeMethods[K]['args']
  }
}[RuntimeMethod]
export type RuntimeMessage =
  | { version: number; kind: 'ready' }
  | { version: number; kind: 'response'; id: string; ok: true; result: unknown }
  | { version: number; kind: 'response'; id: string; ok: false; error: string }
  | {
      version: number
      kind: 'session'
      agentId: string
      state: RuntimeSessionState
      libraryChanged: boolean
    }
  | { version: number; kind: 'auth'; snapshot: AgentAuthSnapshot }
  | { version: number; kind: 'providers_changed' }
  | { version: number; kind: 'fatal'; error: string }
