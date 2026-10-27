import { useEffect, useRef, useState } from 'react'
import {
  CheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  CircleXIcon,
  SquareIcon,
  TerminalIcon,
  XIcon
} from 'lucide-react'
import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@renderer/components/ui/collapsible'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@renderer/components/ui/empty'
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockTitle
} from '@renderer/components/ui/code-block'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { useLanguage } from '@renderer/hooks/use-language'
import { cn } from '@renderer/lib/utils'
import { TaskPanelSection } from './TaskPanelSection'
import {
  isTaskActive,
  type BackgroundTask,
  type BackgroundTaskStatus
} from '../../../shared/background-tasks'

const statusLabels: Record<BackgroundTaskStatus, string> = {
  running: '运行中',
  stopping: '正在停止',
  completed: '已完成',
  failed: '执行失败',
  cancelled: '已停止',
  timed_out: '已超时',
  interrupted: '已中断'
}

function elapsedSeconds(task: BackgroundTask, now: number): number {
  return Math.max(0, Math.floor(((task.finishedAt ?? now) - task.startedAt) / 1000))
}

function TaskDetails({ task, now }: { task: BackgroundTask; now: number }): React.JSX.Element {
  const { t, locale } = useLanguage()
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{new Date(task.startedAt).toLocaleString(locale)}</span>
        <span>{t('耗时 {seconds} 秒', { seconds: elapsedSeconds(task, now) })}</span>
        {task.exitCode !== null && <span>{t('退出码 {code}', { code: task.exitCode })}</span>}
      </div>
      <CodeBlock size="sm">
        <CodeBlockHeader>
          <CodeBlockTitle>{t('命令')}</CodeBlockTitle>
          <CodeBlockActions>
            <CodeBlockCopyButton value={task.command} aria-label={t('复制命令')} />
          </CodeBlockActions>
        </CodeBlockHeader>
        <CodeBlockContent wrap className="max-h-28">
          {task.command}
        </CodeBlockContent>
      </CodeBlock>
      <CodeBlock size="sm">
        <CodeBlockHeader>
          <CodeBlockTitle>{t(isTaskActive(task) ? '实时输出' : '返回结果')}</CodeBlockTitle>
          <CodeBlockActions>
            <CodeBlockCopyButton value={task.output} aria-label={t('复制输出')} />
          </CodeBlockActions>
        </CodeBlockHeader>
        <CodeBlockContent wrap className="max-h-64">
          {task.output || t('暂无输出')}
        </CodeBlockContent>
      </CodeBlock>
      {task.error && (
        <Alert variant="destructive">
          <AlertDescription>{t(task.error)}</AlertDescription>
        </Alert>
      )}
      {task.outputTruncated && (
        <p className="text-xs text-muted-foreground">{t('仅显示末尾输出。')}</p>
      )}
      {task.logTruncated && (
        <p className="text-xs text-muted-foreground">
          {t('日志已达到 10 MiB 上限，后续内容仅保留末尾预览。')}
        </p>
      )}
      <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <dt>{t('工作目录')}</dt>
        <dd className="break-all">{task.cwd}</dd>
        <dt>{t('任务 ID')}</dt>
        <dd className="break-all">{task.id}</dd>
        <dt>{t('日志文件')}</dt>
        <dd className="break-all">{task.logPath}</dd>
      </dl>
    </div>
  )
}

export function BackgroundTasksPanel({
  tasks,
  disabled,
  onStop
}: {
  tasks: BackgroundTask[]
  disabled: boolean
  onStop: (id: string) => Promise<unknown>
}): React.JSX.Element {
  const { t, locale } = useLanguage()
  const [selected, setSelected] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [stopping, setStopping] = useState<Set<string>>(new Set())
  const stoppingRef = useRef(new Set<string>())
  const [now, setNow] = useState(() => Date.now())
  const selectedTask = tasks.find((task) => task.id === selected)
  const active = tasks.filter(isTaskActive).sort((a, b) => b.startedAt - a.startedAt)
  const finished = tasks
    .filter((task) => !isTaskActive(task))
    .sort((a, b) => (b.finishedAt ?? b.startedAt) - (a.finishedAt ?? a.startedAt))
  const visible = showAll ? active : active.slice(0, 4)
  const activeCount = active.length

  useEffect(() => {
    if (!activeCount) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [activeCount])

  async function stop(id: string): Promise<void> {
    if (disabled || stoppingRef.current.has(id)) return
    stoppingRef.current.add(id)
    setStopping(new Set(stoppingRef.current))
    try {
      await onStop(id)
    } finally {
      stoppingRef.current.delete(id)
      setStopping(new Set(stoppingRef.current))
    }
  }

  function taskRow(task: BackgroundTask): React.JSX.Element {
    const failed = task.status === 'failed' || task.status === 'timed_out'
    const active = isTaskActive(task)
    const seconds = elapsedSeconds(task, now)
    const duration =
      seconds < 60
        ? new Intl.NumberFormat(locale, {
            style: 'unit',
            unit: 'second',
            unitDisplay: 'narrow'
          }).format(seconds)
        : Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0')
    const StatusIcon =
      task.status === 'completed' ? CheckIcon : failed ? CircleAlertIcon : CircleXIcon
    const stopDisabled = disabled || task.status === 'stopping' || stopping.has(task.id)
    return (
      <div key={task.id} className="flex min-w-0 items-center gap-0.5">
        <Button
          variant="ghost"
          size="sm"
          className="min-w-0 flex-1 justify-start gap-2"
          onClick={() => setSelected(task.id)}
          aria-haspopup="dialog"
          title={task.command + '\n' + t(statusLabels[task.status])}
          aria-label={t('查看任务：{command}', { command: task.command })}
        >
          <TerminalIcon data-icon="inline-start" />
          <span className="min-w-0 flex-1 truncate text-left">{task.command}</span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{duration}</span>
          {!active && (
            <StatusIcon data-icon="inline-end" className={cn(failed && 'text-destructive')} />
          )}
        </Button>
        {active && (
          <Button
            variant="ghost"
            size="icon-xs"
            disabled={stopDisabled}
            onClick={() => void stop(task.id)}
            aria-label={t('停止任务：{command}', { command: task.command })}
            title={t('停止任务')}
          >
            <SquareIcon />
          </Button>
        )}
      </div>
    )
  }

  return (
    <>
      <TaskPanelSection
        title={t('后台任务')}
        description={t('{count} 运行中', { count: activeCount })}
        count={tasks.length}
        icon={TerminalIcon}
      >
        <div role="region" aria-label={t('后台任务列表')}>
          {!tasks.length ? (
            <Empty className="px-3 py-5">
              <EmptyHeader>
                <EmptyTitle>{t('暂无后台任务')}</EmptyTitle>
                <EmptyDescription>
                  {t('耗时命令会自动转到后台，也可以让模型直接在后台启动。')}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="flex min-w-0 flex-col gap-1">
              {visible.map(taskRow)}
              {active.length > 4 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="justify-start"
                  onClick={() => setShowAll((previous) => !previous)}
                >
                  {t(showAll ? '收起任务' : '显示更多')}
                </Button>
              )}
              {finished.length > 0 && (
                <Collapsible>
                  <CollapsibleTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="sm"
                        className="group/finished w-full justify-start gap-2"
                      />
                    }
                  >
                    <ChevronDownIcon
                      data-icon="inline-start"
                      className="-rotate-90 transition-transform group-aria-expanded/finished:rotate-0"
                    />
                    {t('{count} 个已结束', { count: finished.length })}
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="flex min-w-0 flex-col gap-1">{finished.map(taskRow)}</div>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </div>
          )}
        </div>
      </TaskPanelSection>
      <Dialog
        open={!!selectedTask}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="flex h-[min(820px,90dvh)] w-[min(1120px,94vw)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
        >
          <DialogHeader className="shrink-0 border-b p-6 pr-14">
            <div className="flex items-center gap-2">
              <DialogTitle>{t('任务详情')}</DialogTitle>
              {selectedTask && (
                <Badge
                  variant={
                    selectedTask.status === 'failed' || selectedTask.status === 'timed_out'
                      ? 'destructive'
                      : 'secondary'
                  }
                >
                  {t(statusLabels[selectedTask.status])}
                </Badge>
              )}
            </div>
            <DialogDescription className="sr-only">{selectedTask?.command}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            {selectedTask && <TaskDetails task={selectedTask} now={now} />}
          </div>
          {selectedTask && isTaskActive(selectedTask) && (
            <div className="flex shrink-0 justify-end border-t px-6 py-4">
              <Button
                variant="outline"
                size="sm"
                disabled={
                  disabled || selectedTask.status === 'stopping' || stopping.has(selectedTask.id)
                }
                onClick={() => void stop(selectedTask.id)}
              >
                <SquareIcon data-icon="inline-start" />
                {t(selectedTask.status === 'stopping' ? '正在停止' : '停止任务')}
              </Button>
            </div>
          )}
          <DialogClose
            render={<Button variant="ghost" size="icon-sm" className="absolute right-3 top-3" />}
            aria-label={t('关闭任务详情')}
          >
            <XIcon />
          </DialogClose>
        </DialogContent>
      </Dialog>
    </>
  )
}
