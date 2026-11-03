import type { AgentThinkingLevel } from './agent-messages'

/** 保持 config.json 的既有字段；每个插件只读取自己拥有的配置。 */
export interface AgentSettings {
  defaultProvider?: string
  defaultModel?: string
  enabledModels?: string[]
  defaultThinkingLevel?: AgentThinkingLevel
  modelThinkingLevels?: Record<string, AgentThinkingLevel>
  thinkingBudgets?: Partial<Record<'minimal' | 'low' | 'medium' | 'high', number>>
  hideThinkingBlock?: boolean
  cacheWarming?: 'off' | 'streaming' | 'idle'
  transport?: 'auto' | 'sse' | 'websocket' | 'websocket-cached'
  httpProxy?: string
  httpIdleTimeoutMs?: number
  websocketConnectTimeoutMs?: number
  compaction?: {
    enabled?: boolean
    reserveTokens?: number
    keepRecentTokens?: number
    modelOverrides?: Record<string, { reserveTokens?: number; keepRecentTokens?: number }>
  }
  retry?: {
    enabled?: boolean
    maxRetries?: number
    baseDelayMs?: number
    maxAgentDelayMs?: number
    provider?: { timeoutMs?: number; maxRetries?: number; maxRetryDelayMs?: number }
  }
  defaultTools?: string[]
  codemode?: { mode?: 'on' | 'only'; inlineBudget?: number }
  shellCommandPrefix?: string
  images?: { autoResize?: boolean; blockImages?: boolean }
  agentsFiles?: string[]
  extensions?: string[]
  skills?: string[]
  prompts?: string[]
  enableSkillCommands?: boolean
  deviceId?: string
}
