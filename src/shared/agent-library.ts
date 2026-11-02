export interface SavedSession {
  path: string
  id: string
  cwd: string
  title: string
  created: number
  modified: number
  messageCount: number
}

export interface UsageRecord {
  sessionPath: string
  date: string
  hour: number
  provider: string
  model: string
  messages: number
  requests: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cost: number
}

export interface AgentLibrary {
  sessions: SavedSession[]
  usage: UsageRecord[]
  requests: UsageRequest[]
  updatedAt: number
  warning: string | null
}

export interface UsageRequest extends Omit<UsageRecord, 'messages' | 'requests'> {
  id: string
  timestamp: number
  stopReason: string
}

export type UsagePeriod = 'all' | '365' | '90' | '30' | '7' | '1'

export interface UsageFilters {
  period: UsagePeriod
  provider?: string
  model?: string
}

export interface UsageTotals {
  tokens: number
  requests: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cost: number
}

export interface ProviderUsage extends UsageTotals {
  provider: string
}

export interface ModelUsage extends ProviderUsage {
  model: string
}

export interface UsageDay extends UsageTotals {
  messages: number
}

export interface UsageSummary extends UsageTotals {
  sessions: number
  messages: number
  cache: number
  days: Map<string, UsageDay>
  peakHour: number | null
  favoriteModel: ModelUsage | undefined
  models: ModelUsage[]
  providers: ProviderUsage[]
}

export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function totalTokens(
  record: Pick<UsageRecord, 'input' | 'output' | 'cacheRead' | 'cacheWrite'>
): number {
  return record.input + record.output + record.cacheRead + record.cacheWrite
}

export function filterUsage<T extends Pick<UsageRecord, 'date' | 'provider' | 'model'>>(
  records: T[],
  filters: UsageFilters,
  now = new Date()
): T[] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (filters.period !== 'all') start.setDate(start.getDate() - Number(filters.period) + 1)
  const startKey = filters.period === 'all' ? '' : localDateKey(start)
  const endKey = localDateKey(now)
  return records.filter(
    (record) =>
      record.date >= startKey &&
      record.date <= endKey &&
      (!filters.provider || record.provider === filters.provider) &&
      (!filters.model || record.model === filters.model)
  )
}

export function usageHeatmapWeeks(now = new Date()): Date[][] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - 52 * 7)
  return Array.from({ length: 53 }, (_, week) =>
    Array.from({ length: 7 }, (_, day) => {
      const date = new Date(start)
      date.setDate(date.getDate() + week * 7 + day)
      return date
    })
  )
}

export function cacheHitRate(
  record: Pick<UsageTotals, 'input' | 'cacheRead' | 'cacheWrite'>
): number | null {
  const input = record.input + record.cacheRead + record.cacheWrite
  return input ? record.cacheRead / input : null
}

function emptyTotals(): UsageTotals {
  return { requests: 0, tokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }
}

function addUsage(totals: UsageTotals, record: UsageRecord): void {
  totals.requests += record.requests
  totals.tokens += totalTokens(record)
  totals.input += record.input
  totals.output += record.output
  totals.cacheRead += record.cacheRead
  totals.cacheWrite += record.cacheWrite
  totals.cost += record.cost
}

export function summarizeUsage(
  records: UsageRecord[],
  period: UsagePeriod,
  now = new Date()
): UsageSummary {
  const selected = filterUsage(records, { period }, now)
  const sessions = new Set<string>()
  const days = new Map<string, UsageDay>()
  const hours = Array<number>(24).fill(0)
  const models = new Map<string, ModelUsage>()
  const providers = new Map<string, ProviderUsage>()
  const totals = emptyTotals()
  let messages = 0
  for (const record of selected) {
    sessions.add(record.sessionPath)
    addUsage(totals, record)
    const day = days.get(record.date) ?? { ...emptyTotals(), messages: 0 }
    day.messages += record.messages
    addUsage(day, record)
    days.set(record.date, day)
    hours[record.hour] += record.messages
    messages += record.messages
    if (record.provider || record.requests) {
      const provider = providers.get(record.provider) ?? {
        ...emptyTotals(),
        provider: record.provider
      }
      addUsage(provider, record)
      providers.set(record.provider, provider)
    }
    if (record.model) {
      const key = JSON.stringify([record.provider, record.model])
      const model = models.get(key) ?? {
        ...emptyTotals(),
        provider: record.provider,
        model: record.model
      }
      addUsage(model, record)
      models.set(key, model)
    }
  }
  const rankedModels = [...models.values()].sort(
    (a, b) => b.tokens - a.tokens || b.requests - a.requests
  )
  const favoriteModel = [...rankedModels].sort(
    (a, b) => b.requests - a.requests || b.tokens - a.tokens
  )[0]
  return {
    ...totals,
    sessions: sessions.size,
    messages,
    cache: totals.cacheRead + totals.cacheWrite,
    days,
    peakHour: messages ? hours.indexOf(Math.max(...hours)) : null,
    favoriteModel,
    models: rankedModels,
    providers: [...providers.values()].sort(
      (a, b) => b.tokens - a.tokens || b.requests - a.requests
    )
  }
}
