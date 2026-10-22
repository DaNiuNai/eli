import { Button } from '@renderer/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger
} from '@renderer/components/ui/popover'
import { Progress } from '@renderer/components/ui/progress'
import { compactNumber } from '@renderer/lib/agent-display'
import { useLanguage } from '@renderer/hooks/use-language'
import type { AgentSnapshot } from '../../../shared/agent'

export function ContextUsageIndicator({
  usage,
  contextWindow
}: {
  usage: AgentSnapshot['contextUsage']
  contextWindow: number | undefined
}): React.JSX.Element {
  const { t, locale } = useLanguage()
  const capacity = usage?.contextWindow || contextWindow || 0
  const tokens = usage?.tokens ?? null
  const percent = tokens !== null && capacity > 0 ? (tokens / capacity) * 100 : null
  const progress = percent === null ? null : Math.min(100, Math.max(0, percent))
  const label =
    percent === null
      ? t('上下文用量：等待更新')
      : t('上下文已用 {percent}%', { percent: percent.toFixed(1) })

  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant="ghost" size="icon-sm" />}
        aria-label={t('上下文用量')}
        title={label}
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle
            cx="12"
            cy="12"
            r="9"
            stroke="currentColor"
            strokeWidth="3"
            className="text-muted"
          />
          <circle
            cx="12"
            cy="12"
            r="9"
            stroke="currentColor"
            strokeWidth="3"
            pathLength="100"
            strokeDasharray={progress === null ? '4 8' : `${progress} 100`}
            strokeLinecap="round"
            transform="rotate(-90 12 12)"
            className="text-muted-foreground"
          />
        </svg>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-72 gap-4 p-4">
        <PopoverHeader>
          <PopoverTitle>{t('上下文用量')}</PopoverTitle>
          <PopoverDescription>{t('当前对话占用的模型上下文估算。')}</PopoverDescription>
        </PopoverHeader>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xl font-medium tabular-nums">
            {percent === null ? t('等待更新') : `${percent.toFixed(1)}%`}
          </span>
          <span className="text-xs text-muted-foreground">
            {tokens === null ? '—' : compactNumber(tokens)} /{' '}
            {capacity ? compactNumber(capacity) : '—'} Token
          </span>
        </div>
        <Progress value={progress} aria-label={label} />
        <dl className="grid grid-cols-2 gap-y-2 text-xs">
          <dt className="text-muted-foreground">{t('已使用')}</dt>
          <dd className="text-right tabular-nums">
            {tokens === null ? t('暂不可用') : tokens.toLocaleString(locale)}
          </dd>
          <dt className="text-muted-foreground">{t('上下文容量')}</dt>
          <dd className="text-right tabular-nums">
            {capacity ? capacity.toLocaleString(locale) : t('暂不可用')}
          </dd>
          <dt className="text-muted-foreground">{t('剩余容量')}</dt>
          <dd className="text-right tabular-nums">
            {tokens === null || !capacity
              ? t('暂不可用')
              : Math.max(0, capacity - tokens).toLocaleString(locale)}
          </dd>
        </dl>
      </PopoverContent>
    </Popover>
  )
}
