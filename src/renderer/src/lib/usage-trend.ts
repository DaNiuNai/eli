import { localDateKey, type UsageDay, type UsagePeriod } from '../../../shared/agent-library'

export type UsageTrendMetric = 'tokens' | 'requests' | 'cost'

export interface UsageTrendPoint {
  date: string
  tokens: number
  requests: number
  cost: number
}

export function buildUsageTrend(
  days: ReadonlyMap<string, UsageDay>,
  period: UsagePeriod,
  now = new Date()
): UsageTrendPoint[] {
  const end = localDateKey(now)
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (period === 'all') {
    const first = [...days.keys()].filter((date) => date <= end).sort()[0]
    if (!first) return []
    const [year, month, day] = first.split('-').map(Number)
    start.setFullYear(year, month - 1, day)
  } else {
    start.setDate(start.getDate() - Number(period) + 1)
  }

  const points: UsageTrendPoint[] = []
  // 按本地自然日补零，保留没有调用的日期，不按固定毫秒数跨越夏令时。
  for (const date = new Date(start); localDateKey(date) <= end; date.setDate(date.getDate() + 1)) {
    const key = localDateKey(date)
    const usage = days.get(key)
    points.push({
      date: key,
      tokens: usage?.tokens ?? 0,
      requests: usage?.requests ?? 0,
      cost: usage?.cost ?? 0
    })
  }
  return points
}
