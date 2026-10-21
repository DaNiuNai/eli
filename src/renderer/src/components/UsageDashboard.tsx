import { useMemo, useState } from 'react'
import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@renderer/components/ui/card'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@renderer/components/ui/table'
import { compactNumber } from '@renderer/lib/pi-display'
import { useLanguage } from '@renderer/hooks/use-language'
import {
  localDateKey,
  summarizeUsage,
  type PiLibrary,
  type UsagePeriod
} from '../../../shared/pi-library'

const emptyUsage: PiLibrary['usage'] = []

export function UsageDashboard({
  library,
  loading,
  error
}: {
  library: PiLibrary | null
  loading: boolean
  error: string | null
}): React.JSX.Element {
  const { t, locale } = useLanguage()
  const [period, setPeriod] = useState<UsagePeriod>('all')
  const usage = library?.usage ?? emptyUsage
  const summary = useMemo(() => summarizeUsage(usage, period), [usage, period])
  const days = (() => {
    const end = new Date()
    end.setHours(12, 0, 0, 0)
    end.setDate(end.getDate() + 6 - ((end.getDay() + 6) % 7))
    return Array.from({ length: 182 }, (_, index) => {
      const date = new Date(end)
      date.setDate(end.getDate() - 181 + index)
      return localDateKey(date)
    })
  })()
  const today = localDateKey(new Date())
  const maxTokens = Math.max(1, ...[...summary.days.values()].map((day) => day.tokens))
  const workspaceCount = new Set(library?.sessions.map((session) => session.cwd).filter(Boolean))
    .size
  const metrics = [
    {
      label: '活跃会话',
      value: compactNumber(summary.sessions),
      title: '所选时段内有独立消息或用量记录的会话'
    },
    {
      label: '对话消息',
      value: compactNumber(summary.messages),
      title: '用户消息与助手消息，不包含工具结果'
    },
    {
      label: '总 Token',
      value: compactNumber(summary.tokens),
      title: '输入、输出、缓存读取与缓存写入之和'
    },
    { label: '活跃天数', value: String(summary.days.size), title: '有消息或用量记录的自然日' },
    {
      label: '最活跃时段',
      value: summary.peakHour === null ? '—' : `${String(summary.peakHour).padStart(2, '0')}:00`,
      title: '按本地时间统计，消息最多的小时'
    },
    {
      label: '常用模型',
      value: summary.favoriteModel?.model ?? '—',
      title: summary.favoriteModel
        ? `${summary.favoriteModel.provider} · ${summary.favoriteModel.model}`
        : '尚无模型调用记录'
    }
  ]

  return (
    <section className="dashboard mx-auto w-full max-w-4xl px-6 pb-4 pt-6 sm:px-8">
      <div className="mb-5 flex flex-col gap-2">
        <h1 className="text-2xl font-medium tracking-tight">{t('工作概览')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('本机使用记录')}
          {library &&
            t(' · {workspaces} 个工作目录 · {sessions} 个已保存会话', {
              workspaces: workspaceCount,
              sessions: library.sessions.length
            })}
        </p>
      </div>
      <Card size="sm" className="max-w-[30rem]">
        <CardHeader className="sr-only">
          <CardTitle>{t('用量统计')}</CardTitle>
          <CardDescription>
            {t('根据本地会话文件统计，包含缓存用量，分支继承的相同条目去重。')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="overview">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-1">
              <TabsList variant="line">
                <TabsTrigger value="overview" className="text-xs">
                  {t('概览')}
                </TabsTrigger>
                <TabsTrigger value="models" className="text-xs">
                  {t('模型')}
                </TabsTrigger>
              </TabsList>
              <ToggleGroup
                aria-label={t('统计时间范围')}
                size="sm"
                value={[period]}
                onValueChange={(value) => {
                  if (value[0] === 'all' || value[0] === '30' || value[0] === '7')
                    setPeriod(value[0])
                }}
              >
                <ToggleGroupItem value="all">{t('全部')}</ToggleGroupItem>
                <ToggleGroupItem value="30">{t('30 天')}</ToggleGroupItem>
                <ToggleGroupItem value="7">{t('7 天')}</ToggleGroupItem>
              </ToggleGroup>
            </div>
            <TabsContent value="overview">
              {loading && !library ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {Array.from({ length: 6 }, (_, index) => (
                    <Skeleton key={index} className="h-12" />
                  ))}
                  <Skeleton className="col-span-full mt-1 h-28" />
                </div>
              ) : (
                <>
                  <dl className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                    {metrics.map((metric) => (
                      <div
                        className="min-w-0 rounded-md bg-muted px-2 py-1"
                        key={metric.label}
                        title={t(metric.title)}
                      >
                        <dt className="text-[11px] leading-4 text-muted-foreground">
                          {t(metric.label)}
                        </dt>
                        <dd className="truncate text-sm font-medium leading-5 tabular-nums">
                          {metric.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <div
                    className="usage-heatmap mt-2"
                    role="img"
                    title={t('最近 26 周的活动记录，按本地时间统计')}
                    aria-label={t('最近 26 周的用量热力图，所选时段共 {days} 个活跃日', {
                      days: summary.days.size
                    })}
                  >
                    {days.map((date) => {
                      const activity = summary.days.get(date)
                      const level = !activity
                        ? 0
                        : !activity.tokens
                          ? 1
                          : Math.min(4, Math.ceil((activity.tokens / maxTokens) * 4))
                      return (
                        <span
                          key={date}
                          className="usage-day"
                          data-level={level}
                          data-future={date > today || undefined}
                          title={t('{date} · {messages} 条消息 · {tokens} Token', {
                            date,
                            messages: activity?.messages ?? 0,
                            tokens: (activity?.tokens ?? 0).toLocaleString(locale)
                          })}
                        />
                      )
                    })}
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                    <span>
                      {summary.tokens
                        ? t('输入 {input} · 输出 {output} · 缓存 {cache}', {
                            input: compactNumber(summary.input),
                            output: compactNumber(summary.output),
                            cache: compactNumber(summary.cache)
                          })
                        : t('暂无已保存的用量记录')}
                    </span>
                    <div className="flex shrink-0 items-center gap-1" aria-hidden="true">
                      <span className="mr-1">{t('少')}</span>
                      {[0, 1, 2, 3, 4].map((level) => (
                        <span key={level} className="usage-day size-2" data-level={level} />
                      ))}
                      <span className="ml-1">{t('多')}</span>
                    </div>
                  </div>
                </>
              )}
            </TabsContent>
            <TabsContent value="models">
              {summary.models.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('模型')}</TableHead>
                      <TableHead className="text-right">{t('回复')}</TableHead>
                      <TableHead className="text-right">Token</TableHead>
                      <TableHead className="text-right">{t('记录费用')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.models.map((model) => (
                      <TableRow key={JSON.stringify([model.provider, model.model])}>
                        <TableCell>
                          <div className="max-w-48 truncate" title={model.model}>
                            {model.model}
                          </div>
                          <div className="text-xs text-muted-foreground">{model.provider}</div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {model.requests.toLocaleString(locale)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {compactNumber(model.tokens)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          ${model.cost.toFixed(2)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  {t(loading ? '正在读取模型用量…' : '所选时段还没有模型用量记录')}
                </p>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
        <CardFooter className="flex-wrap justify-between gap-1 py-1.5 text-[10px] text-muted-foreground">
          <span title={t('Token 包含缓存用量，相同分支记录已去重')}>
            {t('热力图：近 26 周 · 记录去重')}
          </span>
          <span>
            {loading
              ? t('更新中…')
              : library
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
      {(error || library?.warning) && (
        <Alert className="mt-3 max-w-[30rem]" variant={error ? 'destructive' : 'default'}>
          <AlertDescription>{t(error || library?.warning || '')}</AlertDescription>
        </Alert>
      )}
    </section>
  )
}
