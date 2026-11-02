import test from 'node:test'
import assert from 'node:assert/strict'
import { buildUsageTrend } from '../src/renderer/src/lib/usage-trend.ts'
import {
  cacheHitRate,
  filterUsage,
  localDateKey,
  summarizeUsage,
  usageHeatmapWeeks
} from '../src/shared/agent-library.ts'

const now = new Date(2026, 10, 2, 18)
const record = (overrides = {}) => ({
  sessionPath: 'fixture-session',
  date: '2026-11-02',
  hour: 12,
  provider: 'fixture',
  model: 'local',
  messages: 1,
  requests: 1,
  input: 10,
  output: 5,
  cacheRead: 80,
  cacheWrite: 10,
  cost: 0.001,
  ...overrides
})

test('用量筛选按本地自然日包含边界，排除未来，并组合供应商与模型条件', () => {
  const records = [
    record({ date: '2026-10-26' }),
    record({ date: '2026-10-27' }),
    record(),
    record({ provider: 'other' }),
    record({ model: 'other' }),
    record({ date: '2026-11-03' })
  ]
  assert.deepEqual(
    filterUsage(records, { period: '7', provider: 'fixture', model: 'local' }, now),
    [records[1], records[2]]
  )
  assert.equal(filterUsage(records, { period: '1' }, now).length, 3)
  assert.equal(filterUsage(records, { period: 'all' }, now).length, 5)
  for (const days of [30, 90, 365]) {
    const first = new Date(now)
    first.setDate(first.getDate() - days + 1)
    const previous = new Date(first)
    previous.setDate(previous.getDate() - 1)
    const boundary = [
      record({ date: localDateKey(previous) }),
      record({ date: localDateKey(first) }),
      record()
    ]
    assert.deepEqual(filterUsage(boundary, { period: String(days) }, now), boundary.slice(1))
  }
})

test('汇总请求、输入输出与缓存，供应商和模型分组不会混合重名模型', () => {
  const summary = summarizeUsage(
    [
      record({ messages: 2, requests: 2 }),
      record({ provider: 'other', input: 20, cacheRead: 0, cacheWrite: 0, cost: 0.002 }),
      record({
        provider: '',
        model: '',
        messages: 1,
        requests: 0,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0
      }),
      record({ date: '2026-11-03', cost: 100 })
    ],
    'all',
    now
  )
  assert.equal(summary.sessions, 1)
  assert.equal(summary.messages, 4)
  assert.equal(summary.requests, 3)
  assert.equal(summary.tokens, 130)
  assert.equal(summary.input, 30)
  assert.equal(summary.output, 10)
  assert.equal(summary.cacheRead, 80)
  assert.equal(summary.cacheWrite, 10)
  assert.equal(summary.cache, 90)
  assert.equal(summary.cost, 0.003)
  assert.equal(summary.providers.length, 2)
  assert.equal(summary.models.length, 2)
  assert.equal(summary.models[0].provider, 'fixture')
  assert.equal(summary.models[0].requests, 2)
  assert.equal(summary.favoriteModel.provider, 'fixture')
  assert.equal(summary.days.get('2026-11-02').requests, 3)
  assert.equal(summary.days.get('2026-11-02').cost, summary.cost)
  assert.equal(summary.peakHour, 12)
})

test('缓存命中率以全部输入为分母，包含缓存写入，忽略输出，空输入显示不可用', () => {
  assert.equal(cacheHitRate(record()), 0.8)
  assert.equal(cacheHitRate(record({ output: 10000 })), 0.8)
  assert.equal(cacheHitRate(record({ input: 0, cacheRead: 0, cacheWrite: 0 })), null)
  assert.equal(cacheHitRate(record({ cacheRead: 0 })), 0)
  const summary = summarizeUsage([], 'all', now)
  assert.equal(summary.requests, 0)
  assert.equal(summary.cost, 0)
  assert.equal(summary.favoriteModel, undefined)
  assert.equal(cacheHitRate(summary), null)
})

test('53 周热力图以周一开始，覆盖当前周，跨年、闰日与夏令时仍保持每日连续', () => {
  for (const today of [
    now,
    new Date(2026, 10, 8),
    new Date(2026, 2, 10),
    new Date(2024, 1, 29),
    new Date(2027, 0, 1)
  ]) {
    const weeks = usageHeatmapWeeks(today)
    assert.equal(weeks.length, 53)
    assert.ok(
      weeks.every((week) => week.length === 7 && week[0].getDay() === 1 && week[6].getDay() === 0)
    )
    const days = weeks.flat()
    assert.equal(new Set(days.map(localDateKey)).size, 371)
    assert.ok(weeks[52].some((day) => localDateKey(day) === localDateKey(today)))
    for (let index = 1; index < days.length; index++) {
      const next = new Date(days[index - 1])
      next.setDate(next.getDate() + 1)
      assert.equal(localDateKey(days[index]), localDateKey(next))
    }
  }
  assert.equal(localDateKey(usageHeatmapWeeks(now)[0][0]), '2025-11-03')
})

test('趋势图使用筛选后的每日汇总，补齐零用量日期，Token 包含缓存且与总量一致', () => {
  const records = [
    record({ date: '2026-10-26' }),
    record({ date: '2026-10-27' }),
    record({ date: '2026-10-29', input: 20 }),
    record({ date: '2026-10-29', output: 10 }),
    record({ provider: 'other' }),
    record({ model: 'other' }),
    record({ date: '2026-11-03' })
  ]
  const summary = summarizeUsage(
    filterUsage(records, { period: '7', provider: 'fixture', model: 'local' }, now),
    'all',
    now
  )
  const points = buildUsageTrend(summary.days, '7', now)
  assert.equal(points.length, 7)
  assert.equal(points[0].date, '2026-10-27')
  assert.equal(points[6].date, '2026-11-02')
  assert.equal(points[0].tokens, 105)
  assert.equal(points[2].tokens, 225)
  assert.deepEqual(points[1], { date: '2026-10-28', tokens: 0, requests: 0, cost: 0 })
  for (const metric of ['tokens', 'requests', 'cost']) {
    assert.equal(
      points.reduce((sum, point) => sum + point[metric], 0),
      summary[metric]
    )
  }
  assert.equal(summary.days.size, 2)
})

test('全部时间趋势从首条记录到今天连续展示，排除未来记录，空历史没有虚构数据', () => {
  const summary = summarizeUsage([record({ date: '2026-10-31' }), record()], 'all', now)
  summary.days.set('2026-11-03', summary.days.get('2026-11-02'))
  const points = buildUsageTrend(summary.days, 'all', now)
  assert.deepEqual(
    points.map((point) => point.date),
    ['2026-10-31', '2026-11-01', '2026-11-02']
  )
  assert.equal(points[1].tokens, 0)
  assert.deepEqual(buildUsageTrend(new Map(), 'all', now), [])
  assert.deepEqual(
    buildUsageTrend(new Map([['2026-11-03', summary.days.get('2026-11-03')]]), 'all', now),
    []
  )
})

test('趋势覆盖所选完整时段，今天保留单个数据点，跨月跨年及闰日不丢失日期', () => {
  for (const period of ['1', '7', '30', '90', '365']) {
    const points = buildUsageTrend(new Map(), period, now)
    assert.equal(points.length, Number(period))
    assert.equal(points.at(-1).date, localDateKey(now))
    assert.ok(
      points.every((point) => point.tokens === 0 && point.requests === 0 && point.cost === 0)
    )
  }
  const summary = summarizeUsage([record()], '1', now)
  assert.deepEqual(buildUsageTrend(summary.days, '1', now), [
    { date: '2026-11-02', tokens: 105, requests: 1, cost: 0.001 }
  ])
  assert.deepEqual(
    buildUsageTrend(new Map(), '7', new Date(2024, 2, 3)).map((point) => point.date),
    [
      '2024-02-26',
      '2024-02-27',
      '2024-02-28',
      '2024-02-29',
      '2024-03-01',
      '2024-03-02',
      '2024-03-03'
    ]
  )
  assert.deepEqual(
    buildUsageTrend(new Map(), '7', new Date(2027, 0, 3))
      .slice(-4)
      .map((point) => point.date),
    ['2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']
  )
})
