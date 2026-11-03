import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ActivityIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from './ui/dialog'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from './ui/empty'
import { Alert, AlertDescription } from './ui/alert'
import { Badge } from './ui/badge'
import { useLanguage } from '../hooks/use-language'
import { cn } from '../lib/utils'
import {
  trajectoryPageSize,
  type TrajectoryKind,
  type TrajectoryPage,
  type TrajectoryRow
} from '../../../shared/trajectory'

const names: Record<TrajectoryKind, string> = {
  turn: '轮次',
  step: '步骤',
  user: '用户消息',
  system: '系统消息',
  developer: '开发者消息',
  request: '请求配置',
  assistant: '模型回复',
  attempt: '模型请求尝试',
  tool: '工具调用',
  subtool: '子工具调用',
  compaction: '上下文压缩'
}
const states: Record<TrajectoryRow['status'], string> = {
  open: '进行中',
  recorded: '已记录',
  error: '已失败',
  interrupted: '已中断'
}
const sections: Record<string, string> = {
  'tool/call': '工具输入',
  'tool/result': '工具输出',
  'tool/ptc-dispatch-start': '子工具输入',
  'tool/ptc-dispatch': '子工具输出',
  'assistant/message': '模型输出',
  'assistant/attempt': '请求结果',
  'compaction/summary': '压缩摘要'
}

function duration(ms: number): string {
  return ms < 1000 ? ms + ' ms' : (ms / 1000).toFixed(2) + ' s'
}

function DetailValue({ value }: { value: unknown }): React.JSX.Element {
  const { t } = useLanguage()
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const message = record.message
  const content =
    record.content ??
    record.summary ??
    (message && typeof message === 'object' && 'content' in message ? message.content : undefined)
  const blocks: string[] = Array.isArray(content)
    ? content.flatMap((block) => (block && typeof block.text === 'string' ? [block.text] : []))
    : []
  const raw = (
    <pre className="whitespace-pre-wrap break-all rounded bg-muted p-2">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
  if (!blocks.length) return raw
  return (
    <>
      <pre className="whitespace-pre-wrap break-words rounded bg-muted p-2">
        {blocks.join('\n\n')}
      </pre>
      <details className="mt-1">
        <summary className="cursor-pointer text-muted-foreground">{t('原始字段')}</summary>
        {raw}
      </details>
    </>
  )
}

interface SessionProps {
  sessionKey: string
  revision: number
}

function Ledger({ sessionKey, revision }: SessionProps): React.JSX.Element {
  const { t, locale } = useLanguage()
  const [offset, setOffset] = useState<number>()
  const [selected, setSelected] = useState<number>()
  const [page, setPage] = useState<TrajectoryPage>()
  const [error, setError] = useState('')
  const viewport = useRef<HTMLDivElement>(null)
  const refresh = useRef<() => void>(undefined)
  const following = useRef(true)

  useEffect(() => {
    let active = true
    let reading = false
    let dirty = false
    async function read(): Promise<void> {
      dirty = true
      if (reading) return
      reading = true
      try {
        while (active && dirty) {
          dirty = false
          const next = await window.api.readTrajectory(sessionKey, { offset, selected })
          if (active) {
            setPage(next)
            setError('')
          }
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        reading = false
      }
    }
    refresh.current = read
    return () => {
      active = false
      refresh.current = undefined
    }
  }, [sessionKey, offset, selected])
  useEffect(() => {
    refresh.current?.()
  }, [revision, sessionKey, offset, selected])
  useLayoutEffect(() => {
    if (offset === undefined && following.current && viewport.current)
      viewport.current.scrollTop = viewport.current.scrollHeight
  }, [page, offset])

  const rows = page?.rows ?? []
  const times = rows.flatMap((row) => (row.start === null ? [] : [row.start, row.end ?? row.start]))
  const first = times.length ? Math.min(...times) : 0
  const last = times.length ? Math.max(...times) : first
  const range = Math.max(1, last - first)
  const selectedRow = rows.find((row) => row.seq === selected)
  const clock = (time: number): string =>
    new Date(time).toLocaleTimeString(locale, { hour12: false })
  const move = (next: number | undefined): void => {
    following.current = next === undefined
    setSelected(undefined)
    setOffset(next)
    if (viewport.current) viewport.current.scrollTop = 0
  }

  return (
    <>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {t(error)}{' '}
            <Button size="sm" variant="ghost" onClick={() => refresh.current?.()}>
              {t('重试')}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">
        <div className="flex flex-wrap items-center gap-1 border-b bg-muted/40 px-3 py-2 text-xs">
          <span className="mr-auto tabular-nums">
            {page?.total
              ? t('第 {start}–{end} 条，共 {total} 条', {
                  start: page.offset + 1,
                  end: page.offset + rows.length,
                  total: page.total
                })
              : t('事件记录')}
          </span>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t('较早记录')}
            disabled={!page?.offset}
            onClick={() => page && move(Math.max(0, page.offset - trajectoryPageSize))}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t('较新记录')}
            disabled={!page || page.offset + rows.length >= page.total}
            onClick={() =>
              page &&
              move(
                page.offset + trajectoryPageSize >= page.total - trajectoryPageSize
                  ? undefined
                  : page.offset + trajectoryPageSize
              )
            }
          >
            <ChevronRightIcon />
          </Button>
          <Button
            size="sm"
            variant={offset === undefined ? 'secondary' : 'ghost'}
            aria-pressed={offset === undefined}
            onClick={() => move(undefined)}
          >
            {t('跟随最新')}
          </Button>
        </div>
        <div
          ref={viewport}
          className="min-h-0 flex-1 overflow-auto"
          onScroll={(event) => {
            const el = event.currentTarget
            if (
              offset === undefined &&
              following.current &&
              page &&
              el.scrollHeight - el.clientHeight - el.scrollTop > 24
            ) {
              following.current = false
              setOffset(page.offset)
            }
          }}
        >
          {!rows.length && !error && (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{page ? t('暂无轨迹') : t('正在读取轨迹')}</EmptyTitle>
                <EmptyDescription>{t('发送消息后，此处会显示会话事件。')}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {rows.length > 0 && (
            <>
              <div className="sticky top-0 grid grid-cols-[minmax(0,1fr)_28%_5rem] gap-3 border-b bg-popover px-3 py-2 text-xs text-muted-foreground">
                <span>{t('轮次 / 步骤 / 事件')}</span>
                <span className="flex justify-between tabular-nums">
                  <span>{times.length ? clock(first) : '—'}</span>
                  <span>{times.length ? clock(last) : '—'}</span>
                </span>
                <span className="text-right">{t('耗时')}</span>
              </div>
              {rows.map((row) => {
                const title =
                  row.kind === 'turn'
                    ? t('第 {n} 轮', { n: row.turn ?? '—' })
                    : row.kind === 'step'
                      ? t('步骤 {n}', { n: row.step ?? '—' })
                      : t(names[row.kind])
                const span =
                  row.start !== null && row.end !== undefined ? row.end - row.start : undefined
                return (
                  <button
                    key={row.seq}
                    type="button"
                    aria-pressed={selected === row.seq}
                    onClick={() => {
                      following.current = false
                      setOffset(page?.offset)
                      setSelected(row.seq)
                    }}
                    className={cn(
                      'grid w-full grid-cols-[minmax(0,1fr)_28%_5rem] items-center gap-3 border-b px-3 py-2 text-left text-xs hover:bg-muted focus-visible:outline-ring',
                      row.kind === 'turn' && 'bg-muted/50 font-semibold',
                      selected === row.seq && 'bg-accent text-accent-foreground'
                    )}
                  >
                    <span
                      className="flex min-w-0 items-center gap-2"
                      style={{
                        paddingInlineStart:
                          Math.min(
                            5,
                            (row.kind === 'turn' ? 0 : row.kind === 'step' ? 1 : 2) +
                              (row.depth ?? 0)
                          ) * 8
                      }}
                    >
                      <span className="shrink-0 text-muted-foreground">
                        {row.turn ?? '·'}
                        {row.step !== null && '.' + row.step}
                      </span>
                      <span className="truncate" title={row.label}>
                        {title}
                        {row.label && ' · ' + row.label}
                      </span>
                    </span>
                    <span className="relative h-3 border-x bg-muted" aria-hidden="true">
                      {row.start !== null && (
                        <span
                          className={cn(
                            'absolute inset-y-0.5 min-w-0.5 rounded bg-primary/65',
                            row.status === 'error' && 'bg-destructive'
                          )}
                          style={{
                            left: Math.min(99, (100 * (row.start - first)) / range) + '%',
                            width: Math.max(0, (100 * (span ?? 0)) / range) + '%'
                          }}
                        />
                      )}
                    </span>
                    <span
                      className={cn(
                        'text-right tabular-nums',
                        row.status === 'error' && 'text-destructive'
                      )}
                    >
                      {row.status !== 'recorded'
                        ? t(states[row.status])
                        : span !== undefined && span >= 0
                          ? duration(span)
                          : '—'}
                    </span>
                  </button>
                )
              })}
            </>
          )}
        </div>
      </div>
      {selectedRow && (
        <section
          aria-label={t('记录详情')}
          className="flex max-h-[38%] min-h-24 flex-col gap-2 overflow-auto rounded-lg border p-3 text-xs"
        >
          <div className="flex flex-wrap items-center gap-2">
            <strong>
              {t('记录详情')} · #{selectedRow.seq} {t(names[selectedRow.kind])}
            </strong>
            <Badge variant="secondary">{t(states[selectedRow.status])}</Badge>
            {selectedRow.parentSeq !== undefined && (
              <span>
                {t('父调用')} #{selectedRow.parentSeq}
              </span>
            )}
            {selectedRow.start !== null && <span>{clock(selectedRow.start)}</span>}
            {selectedRow.start !== null &&
              selectedRow.end !== undefined &&
              selectedRow.end >= selectedRow.start && (
                <span>
                  {t('耗时')} {duration(selectedRow.end - selectedRow.start)}
                </span>
              )}
            {selectedRow.start !== null &&
              selectedRow.firstTokenTime !== undefined &&
              selectedRow.firstTokenTime >= selectedRow.start && (
                <span>
                  {t('首个流事件至首 Token')}{' '}
                  {duration(selectedRow.firstTokenTime - selectedRow.start)}
                </span>
              )}
            {selectedRow.usage && (
              <span>
                {t('输入 / 输出 Token')} {selectedRow.usage.inputTokens} /{' '}
                {selectedRow.usage.outputTokens}
              </span>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={() => setSelected(undefined)}
            >
              {t('收起详情')}
            </Button>
          </div>
          {page?.detail?.[0]?.seq === selectedRow.seq ? (
            page.detail.map((item) => (
              <div key={item.seq}>
                <h4 className="mb-1 font-medium">
                  {sections[item.type] ? t(sections[item.type]) + ' · ' : ''}
                  {item.type}
                </h4>
                <DetailValue value={item.value} />
              </div>
            ))
          ) : (
            <span>{t('正在读取轨迹')}</span>
          )}
        </section>
      )}
    </>
  )
}

export function SessionTrajectory({
  disabled,
  ...props
}: SessionProps & { disabled: boolean }): React.JSX.Element {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={disabled}
            aria-label={t('执行轨迹')}
            title={t('执行轨迹')}
          />
        }
      >
        <ActivityIcon />
      </DialogTrigger>
      <DialogContent className="flex h-[85dvh] max-w-[calc(100%-2rem)] flex-col sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{t('执行轨迹')}</DialogTitle>
          <DialogDescription>
            {t('选择事件查看输入、输出和计时。横条按本页时间范围绘制。')}
          </DialogDescription>
        </DialogHeader>
        {open && <Ledger {...props} />}
      </DialogContent>
    </Dialog>
  )
}
