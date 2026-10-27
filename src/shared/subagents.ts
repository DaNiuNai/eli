import type { AgentSessionSnapshot, AgentThinkingLevel } from './agent'

export const rootAgentId = '/root'
export const maxConcurrentAgents = 4

export type SubagentStatus =
  'starting' | 'running' | 'waiting' | 'completed' | 'failed' | 'interrupted'

export interface SubagentSnapshot {
  id: string
  parentId: string
  taskName: string
  task: string
  status: SubagentStatus
  createdAt: number
  finishedAt?: number
  result: string
  error?: string
  snapshot: AgentSessionSnapshot | null
}

export interface SpawnAgentInput {
  task_name: string
  message: string
  fork_turns?: 'all' | 'none'
  model?: string
  reasoning_effort?: AgentThinkingLevel
}

export interface SubagentMessage {
  type: 'MESSAGE' | 'FINAL_ANSWER' | 'INTERRUPTED'
  sender: string
  recipient: string
  text: string
}

export type SubagentAction =
  | { type: 'interrupt'; target: string }
  | { type: 'followup'; target: string; message: string }
  | { type: 'message'; target: string; message: string }

export function isSubagentActive(agent: Pick<SubagentSnapshot, 'status'>): boolean {
  return ['starting', 'running', 'waiting'].includes(agent.status)
}
