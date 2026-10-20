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

export interface PiLibrary {
  sessions: SavedSession[]
  usage: UsageRecord[]
  updatedAt: number
  warning: string | null
}

export type UsagePeriod = 'all' | '30' | '7'

export interface ModelUsage {
  provider: string
  model: string
  tokens: number
  requests: number
  cost: number
}

export interface UsageSummary {
  sessions: number
  messages: number
  tokens: number
  input: number
  output: number
  cache: number
  cost: number
  days: Map<string, { messages: number; tokens: number }>
  peakHour: number | null
  favoriteModel: ModelUsage | undefined
  models: ModelUsage[]
}

export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function totalTokens(
  record: Pick<UsageRecord, 'input' | 'output' | 'cacheRead' | 'cacheWrite'>
): number {
  return record.input + record.output + record.cacheRead + record.cacheWrite
}

export function summarizeUsage(
  records: UsageRecord[],
  period: UsagePeriod,
  now = new Date()
): UsageSummary {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (period !== 'all') start.setDate(start.getDate() - Number(period) + 1)
  const startKey = period === 'all' ? '' : localDateKey(start)
  const endKey = localDateKey(now)
  const selected = records.filter((record) => record.date >= startKey && record.date <= endKey)
  const sessions = new Set<string>()
  const days = new Map<string, { messages: number; tokens: number }>()
  const hours = Array<number>(24).fill(0)
  const models = new Map<
    string,
    { provider: string; model: string; tokens: number; requests: number; cost: number }
  >()
  let messages = 0
  let input = 0
  let output = 0
  let cache = 0
  let cost = 0
  for (const record of selected) {
    sessions.add(record.sessionPath)
    const tokens = totalTokens(record)
    const day = days.get(record.date) ?? { messages: 0, tokens: 0 }
    day.messages += record.messages
    day.tokens += tokens
    days.set(record.date, day)
    hours[record.hour] += record.messages
    messages += record.messages
    input += record.input
    output += record.output
    cache += record.cacheRead + record.cacheWrite
    cost += record.cost
    if (record.model) {
      const key = JSON.stringify([record.provider, record.model])
      const model = models.get(key) ?? {
        provider: record.provider,
        model: record.model,
        tokens: 0,
        requests: 0,
        cost: 0
      }
      model.tokens += tokens
      model.requests += record.requests
      model.cost += record.cost
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
    sessions: sessions.size,
    messages,
    tokens: input + output + cache,
    input,
    output,
    cache,
    cost,
    days,
    peakHour: messages ? hours.indexOf(Math.max(...hours)) : null,
    favoriteModel,
    models: rankedModels
  }
}
