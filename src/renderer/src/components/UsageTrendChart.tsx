import { useMemo } from 'react'
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@renderer/components/ui/chart'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@renderer/components/ui/empty'
import { useLanguage } from '@renderer/hooks/use-language'
import { compactNumber } from '@renderer/lib/agent-display'
import { buildUsageTrend, type UsageTrendMetric } from '@renderer/lib/usage-trend'
import type { UsageDay, UsagePeriod } from '../../../shared/agent-library'

export function UsageTrendChart({
  days,
  period,
  today,
  metric,
  label,
  formatValue
}: {
  days: ReadonlyMap<string, UsageDay>
  period: UsagePeriod
  today: string
  metric: UsageTrendMetric
  label: string
  formatValue: (value: number) => string
}): React.JSX.Element {
  const { t, locale } = useLanguage()
  const data = useMemo(
    () => buildUsageTrend(days, period, new Date(`${today}T12:00:00`)),
    [days, period, today]
  )
  if (!days.size || !data.length) {
    return (
      <Empty className="h-64">
        <EmptyHeader>
          <EmptyTitle>{t('所选范围暂无用量记录')}</EmptyTitle>
          <EmptyDescription>
            {t('尝试调整筛选条件；使用模型后，已保存的本地会话用量会显示在这里。')}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <>
      <ChartContainer
        config={{ [metric]: { label, color: 'var(--primary)' } }}
        className="h-64 w-full aspect-auto"
        aria-label={t('每日{metric}用量趋势', { metric: label })}
      >
        <LineChart
          accessibilityLayer
          data={data}
          margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
        >
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={32}
            interval="preserveStartEnd"
            tickFormatter={(date: string) =>
              new Date(`${date}T12:00:00`).toLocaleDateString(locale, {
                month: 'short',
                day: 'numeric'
              })
            }
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            width={metric === 'cost' ? 88 : 54}
            domain={[0, 'auto']}
            allowDecimals={metric === 'cost'}
            tickFormatter={(value: number) =>
              metric === 'cost' ? formatValue(value) : compactNumber(value)
            }
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(date) =>
                  new Date(`${String(date)}T12:00:00`).toLocaleDateString(locale, {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  })
                }
                formatter={(value) => (
                  <div className="flex w-full items-center justify-between gap-4">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-mono tabular-nums">
                      {typeof value === 'number' ? formatValue(value) : String(value)}
                    </span>
                  </div>
                )}
              />
            }
          />
          <Line
            type="monotone"
            dataKey={metric}
            stroke={`var(--color-${metric})`}
            strokeWidth={2}
            dot={data.length <= 14 ? { r: 3 } : false}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ChartContainer>
      <p className="mt-3 text-xs text-muted-foreground">
        {data[0].date} — {data[data.length - 1].date}
      </p>
    </>
  )
}
