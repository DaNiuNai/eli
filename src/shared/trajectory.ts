import type { TokenUsage } from '@deepseek-ai/dsh-llm'

export type TrajectoryKind =
  | 'turn'
  | 'step'
  | 'user'
  | 'system'
  | 'developer'
  | 'request'
  | 'assistant'
  | 'attempt'
  | 'tool'
  | 'subtool'
  | 'compaction'

export interface TrajectoryRow {
  seq: number
  kind: TrajectoryKind
  turn: number | null
  step: number | null
  label?: string
  parentSeq?: number
  depth?: number
  start: number | null
  end?: number
  status: 'open' | 'recorded' | 'error' | 'interrupted'
  usage?: TokenUsage
  firstTokenTime?: number
}

export interface TrajectoryQuery {
  /** Omitted on the live tail. Earlier pages keep a fixed starting row. */
  offset?: number
  selected?: number
}

export function isTrajectoryQuery(value: unknown): value is TrajectoryQuery {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.entries(value).every(
    ([key, n]) =>
      (key === 'offset' || key === 'selected') &&
      (n === undefined || (Number.isSafeInteger(n) && n >= 0))
  )
}

export interface TrajectoryPage {
  rows: TrajectoryRow[]
  offset: number
  total: number
  detail?: { seq: number; type: string; value: unknown }[]
}

export const trajectoryPageSize = 60
