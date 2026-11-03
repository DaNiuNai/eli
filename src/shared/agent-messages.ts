import type {
  ImageContent,
  Message,
  ModelThinkingLevel,
  TextContent,
  JsonObject,
  JsonValue
} from '@earendil-works/pi-ai'

/** eli 的显示协议。旧会话和 dsh 事件都投影到这些值，不暴露引擎实例。 */
export type AgentMessage =
  | Message
  | {
      role: 'custom'
      customType: string
      content: string | (TextContent | ImageContent)[]
      display: boolean
      details?: unknown
      timestamp: number
    }
  | { role: 'branchSummary'; summary: string; fromId: string | null; timestamp: number }
  | { role: 'compactionSummary'; summary: string; tokensBefore: number; timestamp: number }
  | {
      role: 'bashExecution'
      command: string
      output: string
      exitCode: number | undefined
      cancelled: boolean
      truncated: boolean
      fullOutputPath?: string
      excludeFromContext?: boolean
      timestamp: number
    }

export type AgentThinkingLevel = ModelThinkingLevel

export interface ContextUsage {
  tokens: number | null
  contextWindow: number
  percent: number | null
}

export type AgentToolEvent =
  | { type: 'tool_execution_start'; toolCallId: string; toolName: string; args: JsonObject }
  | {
      type: 'tool_execution_update'
      toolCallId: string
      toolName: string
      args: JsonObject
      partialResult: { content: (TextContent | ImageContent)[]; details?: JsonValue }
    }
  | {
      type: 'tool_execution_end'
      toolCallId: string
      toolName: string
      result: { content: (TextContent | ImageContent)[]; details?: JsonValue }
      isError: boolean
    }
