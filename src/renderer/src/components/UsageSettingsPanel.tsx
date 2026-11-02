import { useMemo, useState } from 'react'
import {
  BarChart3Icon,
  CalendarDaysIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  RefreshCwIcon
} from 'lucide-react'
import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@renderer/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@renderer/components/ui/empty'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Skeleton } from '@renderer/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@renderer/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group'
import { useLanguage } from '@renderer/hooks/use-language'
import { compactNumber } from '@renderer/lib/agent-display'
import {
  cacheHitRate,
  filterUsage,
  localDateKey,
  summarizeUsage,
  usageHeatmapWeeks,
  type AgentLibrary,
  type ProviderUsage,
  type UsagePeriod,
  type UsageRequest,
  type UsageSummary
} from '../../../shared/agent-library'

export interface UsageSettingsPanelProps {
  library: AgentLibrary | null
  loading: boolean
  error: string | null
  onReload: () => void
}

const emptyUsage: AgentLibrary['usage'] = []
const emptyRequests: UsageRequest[] = []
const periods: { value: UsagePeriod; label: string }[] = [
  { value: 'all', label: '全部时间' },
  { value: '1', label: '今天' },
  { value: '7', label: '最近 7 天' },
  { value: '30', label: '最近 30 天' },
  { value: '90', label: '最近 90 天' },
  { value: '365', label: '最近一年' }
]
const metrics = [
  { value: 'tokens', label: 'Token' },
  { value: 'requests', label: '请求数' },
  { value: 'cost', label: '费用' }
] as const
type HeatmapMetric = (typeof metrics)[number]['value']
const pageSize = 20

function formatCost(value: number, locale: string, detailed = false): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: detailed || (value > 0 && value < 0.01) ? 6 : 2
  }).format(value)
}

function formatRate(record: Parameters<typeof cacheHitRate>[0], locale: string): string {
  const rate = cacheHitRate(record)
  return rate === null
    ? '—'
    : rate.toLocaleString(locale, { style: 'percent', maximumFractionDigits: 1 })
}

function UsageHeatmap({
  summary,
  today
}: {
  summary: UsageSummary
  today: string
}): React.JSX.Element {
  const { t, locale } = useLanguage()
  const [metric, setMetric] = useState<HeatmapMetric>('tokens')
  const weeks = useMemo(() => usageHeatmapWeeks(new Date(`${today}T12:00:00`)), [today])
  const firstDay = localDateKey(weeks[0][0])
  const maximum =
    Math.max(
      0,
      ...weeks.flat().map((date) => summary.days.get(localDateKey(date))?.[metric] ?? 0)
    ) || 1
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle>{t('用量热力图')}</CardTitle>
            <CardDescription>{t('最近 53 周的每日用量，按本地时间统计。')}</CardDescription>
          </div>
          <ToggleGroup
            variant="outline"
            size="sm"
            value={[metric]}
            onValueChange={(values) => {
              const next = metrics.find((item) => item.value === values[0])
              if (next) setMetric(next.value)
            }}
            aria-label={t('热力图统计指标')}
          >
            {metrics.map((item) => (
              <ToggleGroupItem key={item.value} value={item.value}>
                {t(item.label)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto pb-1">
          <div className="min-w-[680px]">
            <div
              className="mb-2 ml-8 grid grid-cols-[repeat(53,minmax(0,1fr))] gap-[3px] text-[10px] text-muted-foreground"
              aria-hidden="true"
            >
              {weeks.map((week, index) => (
                <span key={localDateKey(week[0])} className="whitespace-nowrap">
                  {index === 0 || week[0].getMonth() !== weeks[index - 1][0].getMonth()
                    ? week[0].toLocaleDateString(locale, { month: 'short' })
                    : ''}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2">
              <div
                className="grid grid-rows-7 items-center gap-[3px] text-[10px] leading-none text-muted-foreground"
                aria-hidden="true"
              >
                {[0, 1, 2, 3, 4, 5, 6].map((day) => (
                  <span key={day}>
                    {day % 2 === 0
                      ? weeks[0][day].toLocaleDateString(locale, { weekday: 'short' })
                      : ''}
                  </span>
                ))}
              </div>
              <div
                className="grid grid-cols-[repeat(53,minmax(0,1fr))] gap-[3px]"
                role="img"
                aria-label={t('最近 53 周的用量热力图，从 {start} 至 {end}', {
                  start: firstDay,
                  end: today
                })}
              >
                {weeks.map((week) => (
                  <div key={localDateKey(week[0])} className="grid grid-rows-7 gap-[3px]">
                    {week.map((day) => {
                      const date = localDateKey(day)
                      const activity = summary.days.get(date)
                      const value = activity?.[metric] ?? 0
                      const level = value
                        ? Math.min(4, Math.max(1, Math.ceil((value / maximum) * 4)))
                        : 0
                      return (
                        <span
                          key={date}
                          className="usage-day"
                          data-level={level}
                          data-future={date > today || undefined}
                          title={t('{date} · {requests} 次请求 · {tokens} Token · {cost}', {
                            date,
                            requests: (activity?.requests ?? 0).toLocaleString(locale),
                            tokens: (activity?.tokens ?? 0).toLocaleString(locale),
                            cost: formatCost(activity?.cost ?? 0, locale, true)
                          })}
                        />
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {firstDay} — {today}
          </span>
          <div className="flex items-center gap-1" aria-hidden="true">
            <span className="mr-1">{t('少')}</span>
            {[0, 1, 2, 3, 4].map((level) => (
              <span key={level} className="usage-day size-2.5" data-level={level} />
            ))}
            <span className="ml-1">{t('多')}</span>
          </div>
        </div>
      </CardContent>
      <CardFooter>
        <p className="text-xs text-muted-foreground">
          {t('热力图与上方筛选联动，颜色深浅表示所选指标的每日用量。')}
        </p>
      </CardFooter>
    </Card>
  )
}

function UsageEmpty(): React.JSX.Element {
  const { t } = useLanguage()
  return (
    <Empty className="py-12">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <BarChart3Icon />
        </EmptyMedia>
        <EmptyTitle>{t('所选范围暂无用量记录')}</EmptyTitle>
        <EmptyDescription>
          {t('尝试调整筛选条件；使用模型后，已保存的本地会话用量会显示在这里。')}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function UsageBreakdownTable({
  rows,
  models = false
}: {
  rows: (ProviderUsage & { model?: string })[]
  models?: boolean
}): React.JSX.Element {
  const { t, locale } = useLanguage()
  if (!rows.length) return <UsageEmpty />
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t(models ? '模型' : '供应商')}</TableHead>
          <TableHead className="text-right">{t('记录费用')}</TableHead>
          <TableHead className="text-right">{t('请求数')}</TableHead>
          <TableHead className="text-right">Token</TableHead>
          <TableHead className="text-right">{t('新增输入')}</TableHead>
          <TableHead className="text-right">{t('输出')}</TableHead>
          <TableHead className="text-right">{t('缓存读取')}</TableHead>
          <TableHead className="text-right">{t('缓存写入')}</TableHead>
          <TableHead className="text-right">{t('缓存命中率')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={JSON.stringify([row.provider, row.model])}>
            <TableCell>
              <div className="max-w-48 truncate" title={models ? row.model : row.provider}>
                {(models ? row.model : row.provider) || t('未知供应商')}
              </div>
              {models && (
                <div
                  className="max-w-48 truncate text-xs text-muted-foreground"
                  title={row.provider}
                >
                  {row.provider || t('未知供应商')}
                </div>
              )}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatCost(row.cost, locale, true)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {row.requests.toLocaleString(locale)}
            </TableCell>
            {[row.tokens, row.input, row.output, row.cacheRead, row.cacheWrite].map(
              (value, index) => (
                <TableCell
                  key={index}
                  className="text-right tabular-nums"
                  title={value.toLocaleString(locale)}
                >
                  {compactNumber(value)}
                </TableCell>
              )
            )}
            <TableCell className="text-right tabular-nums">{formatRate(row, locale)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function requestStatus(request: UsageRequest): string {
  return ['stop', 'length', 'toolUse'].includes(request.stopReason)
    ? 'success'
    : ['error', 'aborted'].includes(request.stopReason)
      ? request.stopReason
      : 'unknown'
}

function RequestLog({
  requests,
  sessions
}: {
  requests: UsageRequest[]
  sessions: Map<string, string>
}): React.JSX.Element {
  const { t, locale } = useLanguage()
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(0)
  const selected = useMemo(
    () => requests.filter((request) => status === 'all' || requestStatus(request) === status),
    [requests, status]
  )
  const pages = Math.max(1, Math.ceil(selected.length / pageSize))
  const currentPage = Math.min(page, pages - 1)
  const labels: Record<string, string> = {
    stop: '完成',
    length: '输出上限',
    toolUse: '工具调用',
    error: '失败',
    aborted: '已取消'
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {t('逐次模型回复记录，包含工具调用与失败请求。')}
        </p>
        <Select
          value={status}
          onValueChange={(value) => {
            if (value) {
              setStatus(value)
              setPage(0)
            }
          }}
          items={{
            all: t('全部状态'),
            success: t('已完成'),
            error: t('失败'),
            aborted: t('已取消'),
            unknown: t('未知状态')
          }}
        >
          <SelectTrigger size="sm" aria-label={t('筛选请求状态')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {[
                ['all', '全部状态'],
                ['success', '已完成'],
                ['error', '失败'],
                ['aborted', '已取消'],
                ['unknown', '未知状态']
              ].map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {t(label)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      {selected.length ? (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('时间')}</TableHead>
                <TableHead>{t('供应商 / 模型')}</TableHead>
                <TableHead>{t('状态')}</TableHead>
                <TableHead className="text-right">{t('记录费用')}</TableHead>
                <TableHead className="text-right">{t('新增输入')}</TableHead>
                <TableHead className="text-right">{t('输出')}</TableHead>
                <TableHead className="text-right">{t('缓存读取')}</TableHead>
                <TableHead className="text-right">{t('缓存写入')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {selected
                .slice(currentPage * pageSize, (currentPage + 1) * pageSize)
                .map((request) => (
                  <TableRow key={request.id}>
                    <TableCell title={sessions.get(request.sessionPath)}>
                      <time
                        dateTime={new Date(request.timestamp).toISOString()}
                        className="whitespace-nowrap tabular-nums"
                      >
                        {new Date(request.timestamp).toLocaleString(locale, {
                          year: 'numeric',
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                          hour12: false
                        })}
                      </time>
                    </TableCell>
                    <TableCell>
                      <div className="max-w-44 truncate" title={request.model}>
                        {request.model || t('未知模型')}
                      </div>
                      <div
                        className="max-w-44 truncate text-xs text-muted-foreground"
                        title={request.provider}
                      >
                        {request.provider || t('未知供应商')}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          request.stopReason === 'error'
                            ? 'destructive'
                            : requestStatus(request) === 'success'
                              ? 'secondary'
                              : 'outline'
                        }
                      >
                        {t(labels[request.stopReason] || '未知状态')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCost(request.cost, locale, true)}
                    </TableCell>
                    {[request.input, request.output, request.cacheRead, request.cacheWrite].map(
                      (value, index) => (
                        <TableCell
                          key={index}
                          className="text-right tabular-nums"
                          title={value.toLocaleString(locale)}
                        >
                          {compactNumber(value)}
                        </TableCell>
                      )
                    )}
                  </TableRow>
                ))}
            </TableBody>
          </Table>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {t('共 {count} 条 · 第 {page} / {pages} 页', {
                count: selected.length.toLocaleString(locale),
                page: currentPage + 1,
                pages
              })}
            </span>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="icon-sm"
                aria-label={t('上一页')}
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                <ChevronLeftIcon />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label={t('下一页')}
                disabled={currentPage >= pages - 1}
                onClick={() => setPage(currentPage + 1)}
              >
                <ChevronRightIcon />
              </Button>
            </div>
          </div>
        </>
      ) : (
        <UsageEmpty />
      )}
    </div>
  )
}

export function UsageSettingsPanel({
  library,
  loading,
  error,
  onReload
}: UsageSettingsPanelProps): React.JSX.Element {
  const { t, locale } = useLanguage()
  const [period, setPeriod] = useState<UsagePeriod>('all')
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const usage = library?.usage ?? emptyUsage
  const requests = library?.requests ?? emptyRequests
  const today = localDateKey(new Date())
  const providers = useMemo(
    () =>
      [
        ...new Set(usage.filter((record) => record.provider).map((record) => record.provider))
      ].sort(),
    [usage]
  )
  const models = useMemo(
    () =>
      [
        ...new Set(
          usage
            .filter((record) => record.model && (!provider || record.provider === provider))
            .map((record) => record.model)
        )
      ].sort(),
    [usage, provider]
  )
  const filters = useMemo(() => ({ period, provider, model }), [period, provider, model])
  const summary = useMemo(() => {
    const now = new Date(`${today}T12:00:00`)
    return summarizeUsage(filterUsage(usage, filters, now), 'all', now)
  }, [usage, filters, today])
  const selectedRequests = useMemo(
    () => filterUsage(requests, filters, new Date(`${today}T12:00:00`)),
    [requests, filters, today]
  )
  const sessions = useMemo(
    () => new Map(library?.sessions.map((session) => [session.path, session.title])),
    [library?.sessions]
  )
  const cards = [
    {
      label: '记录费用（USD）',
      value: formatCost(summary.cost, locale),
      description:
        '会话中保存的估算费用，单位为美元；未配置价格的模型可能记录为 0，不代表实际账单。'
    },
    {
      label: '总请求数',
      value: summary.requests.toLocaleString(locale),
      description: '每条助手回复计一次请求，包含工具调用、失败与取消记录，不包含用户消息。'
    },
    {
      label: '总 Token',
      value: compactNumber(summary.tokens),
      description: '输入、输出、缓存读取与缓存写入之和'
    },
    {
      label: '缓存命中率',
      value: formatRate(summary, locale),
      description: '缓存读取 /（新增输入 + 缓存读取 + 缓存写入），无输入时不计算。'
    }
  ]
  return (
    <section
      className="@container flex min-w-0 flex-col gap-5"
      aria-label={t('用量看板')}
      aria-busy={loading}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={period}
          onValueChange={(value) => {
            if (periods.some((item) => item.value === value)) setPeriod(value as UsagePeriod)
          }}
          items={periods.map((item) => ({ value: item.value, label: t(item.label) }))}
        >
          <SelectTrigger size="sm" aria-label={t('统计时间范围')}>
            <CalendarDaysIcon />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {periods.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {t(item.label)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select
          value={provider}
          onValueChange={(value) => {
            setProvider(value ?? '')
            setModel('')
          }}
          items={[
            { value: '', label: t('全部供应商') },
            ...providers.map((value) => ({ value, label: value }))
          ]}
        >
          <SelectTrigger size="sm" className="max-w-52" aria-label={t('筛选供应商')}>
            <SelectValue className="min-w-0 truncate" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="">{t('全部供应商')}</SelectItem>
              {providers.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select
          value={model}
          onValueChange={(value) => setModel(value ?? '')}
          items={[
            { value: '', label: t('全部模型') },
            ...models.map((value) => ({ value, label: value }))
          ]}
        >
          <SelectTrigger size="sm" className="max-w-56" aria-label={t('筛选模型')}>
            <SelectValue className="min-w-0 truncate" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="">{t('全部模型')}</SelectItem>
              {models.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="icon-sm"
          className="ml-auto"
          aria-label={t('刷新统计')}
          title={t('刷新统计')}
          disabled={loading}
          onClick={onReload}
        >
          <RefreshCwIcon />
        </Button>
      </div>
      {(error || library?.warning) && (
        <Alert variant={error ? 'destructive' : 'default'}>
          <AlertDescription>{t(error || library?.warning || '')}</AlertDescription>
        </Alert>
      )}
      <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.label} size="sm">
            <CardHeader>
              <CardDescription title={t(card.description)}>{t(card.label)}</CardDescription>
              <CardTitle>
                {loading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <span
                    className="text-2xl tabular-nums tracking-tight"
                    title={
                      card.label === '总 Token' ? summary.tokens.toLocaleString(locale) : undefined
                    }
                  >
                    {card.value}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>
      {loading ? (
        <Skeleton className="h-60 w-full" />
      ) : (
        <UsageHeatmap summary={summary} today={today} />
      )}
      <Card>
        <CardHeader>
          <CardTitle>{t('用量明细')}</CardTitle>
          <CardDescription>
            {t('统计已保存的主会话记录，分支继承的相同条目已去重。')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <Tabs defaultValue="requests" className="gap-4">
              <TabsList variant="line">
                <TabsTrigger value="requests">
                  {t('请求日志')}
                  <Badge variant="secondary">
                    {selectedRequests.length.toLocaleString(locale)}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="providers">
                  {t('供应商')}
                  <Badge variant="secondary">{summary.providers.length}</Badge>
                </TabsTrigger>
                <TabsTrigger value="models">
                  {t('模型')}
                  <Badge variant="secondary">{summary.models.length}</Badge>
                </TabsTrigger>
              </TabsList>
              <TabsContent value="requests">
                <RequestLog
                  key={JSON.stringify(filters)}
                  requests={selectedRequests}
                  sessions={sessions}
                />
              </TabsContent>
              <TabsContent value="providers">
                <UsageBreakdownTable rows={summary.providers} />
              </TabsContent>
              <TabsContent value="models">
                <UsageBreakdownTable rows={summary.models} models />
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
        <CardFooter className="flex-wrap justify-between gap-2">
          <span
            className="text-xs text-muted-foreground"
            title={t('费用来自本地会话记录，不包含供应商账单查询。')}
          >
            {t('本机使用记录')} · USD
          </span>
          <span className="text-xs text-muted-foreground">
            {library
              ? t('更新于 {time}', {
                  time: new Date(library.updatedAt).toLocaleTimeString(locale, {
                    hour: '2-digit',
                    minute: '2-digit'
                  })
                })
              : t('等待本地记录')}
          </span>
        </CardFooter>
      </Card>
    </section>
  )
}
