import { useState } from 'react'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ListTodoIcon,
  SquareIcon,
  TerminalIcon
} from 'lucide-react'
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
import { useLanguage } from '@renderer/hooks/use-language'
import { cn } from '@renderer/lib/utils'
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

function TaskDetails({ task }: { task: BackgroundTask }): React.JSX.Element {
  const { t, locale } = useLanguage()
  return (
    <div className="flex min-w-0 flex-col gap-2 px-2 pb-3 pt-2">
      <pre className="whitespace-pre-wrap break-all text-xs">{task.command}</pre>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{new Date(task.startedAt).toLocaleString(locale)}</span>
        {task.finishedAt && (
          <span>
            {t('耗时 {seconds} 秒', {
              seconds: ((task.finishedAt - task.startedAt) / 1000).toFixed(1)
            })}
          </span>
        )}
        {task.exitCode !== null && <span>{t('退出码 {code}', { code: task.exitCode })}</span>}
      </div>
      <CodeBlock size="sm">
        <CodeBlockHeader>
          <CodeBlockTitle>{t(isTaskActive(task) ? '实时输出' : '返回结果')}</CodeBlockTitle>
          <CodeBlockActions>
            <CodeBlockCopyButton value={task.output} aria-label={t('复制输出')} />
          </CodeBlockActions>
        </CodeBlockHeader>
        <CodeBlockContent wrap className="max-h-48">
          {task.output || t('暂无输出')}
        </CodeBlockContent>
      </CodeBlock>
      {task.error && <p className="break-all text-xs text-destructive">{t(task.error)}</p>}
      {task.outputTruncated && (
        <p className="text-xs text-muted-foreground">{t('仅显示末尾输出。')}</p>
      )}
      {task.logTruncated && (
        <p className="text-xs text-muted-foreground">
          {t('日志已达到 10 MiB 上限，后续内容仅保留末尾预览。')}
        </p>
      )}
      <dl className="grid min-w-0 gap-1 text-xs text-muted-foreground">
        <dt>{t('工作目录')}</dt>
        <dd className="break-all">{task.cwd}</dd>
        <dt className="mt-1">{t('任务 ID')}</dt>
        <dd className="break-all">{task.id}</dd>
        <dt className="mt-1">{t('日志文件')}</dt>
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
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [stopping, setStopping] = useState<Set<string>>(new Set())
  const running = tasks.filter(isTaskActive).length
  const sorted = [...tasks].sort(
    (a, b) => Number(isTaskActive(b)) - Number(isTaskActive(a)) || b.startedAt - a.startedAt
  )
  const stop = async (id: string): Promise<void> => {
    setStopping((previous) => new Set(previous).add(id))
    try {
      await onStop(id)
    } finally {
      setStopping((previous) => {
        const next = new Set(previous)
        next.delete(id)
        return next
      })
    }
  }

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      data-background-tasks-open={open}
      render={<Card size="sm" className="background-tasks-card gap-0 py-0" />}
    >
      <CardHeader className="p-1">
        <CardTitle>
          <CollapsibleTrigger
            render={<Button variant="ghost" size="sm" className="w-full justify-start gap-2" />}
            aria-label={t('展开或收起后台任务')}
          >
            <ListTodoIcon data-icon="inline-start" />
            <span>{t('后台任务')}</span>
            <Badge variant="secondary">
              {running ? t('{count} 运行中', { count: running }) : tasks.length}
            </Badge>
            <ChevronDownIcon
              data-icon="inline-end"
              className={cn('ml-auto transition-transform', open && 'rotate-180')}
            />
          </CollapsibleTrigger>
        </CardTitle>
        {open && (
          <CardDescription className="px-2 pb-2">
            {t('当前对话 · {count} 个任务', { count: tasks.length })}
          </CardDescription>
        )}
      </CardHeader>
      <CollapsibleContent>
        <CardContent
          className="background-tasks-list px-1"
          role="region"
          aria-label={t('后台任务列表')}
        >
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
            <div className="flex min-w-0 flex-col gap-1 pb-1">
              {sorted.map((task) => (
                <Collapsible key={task.id}>
                  <div className="flex min-w-0 items-center gap-1">
                    <CollapsibleTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="sm"
                          className="group/task min-w-0 flex-1 justify-start gap-2"
                        />
                      }
                      aria-label={t('展开或收起任务：{command}', { command: task.command })}
                      title={task.command}
                    >
                      <TerminalIcon data-icon="inline-start" />
                      <span className="min-w-0 flex-1 truncate text-left">{task.command}</span>
                      <Badge
                        variant={
                          task.status === 'failed' || task.status === 'timed_out'
                            ? 'destructive'
                            : 'secondary'
                        }
                      >
                        {t(statusLabels[task.status])}
                      </Badge>
                      <ChevronRightIcon
                        data-icon="inline-end"
                        className="transition-transform group-aria-expanded/task:rotate-90"
                      />
                    </CollapsibleTrigger>
                    {isTaskActive(task) && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={disabled || task.status === 'stopping' || stopping.has(task.id)}
                        onClick={() => void stop(task.id)}
                        aria-label={t('停止任务：{command}', { command: task.command })}
                        title={t('停止任务')}
                      >
                        <SquareIcon />
                      </Button>
                    )}
                  </div>
                  <CollapsibleContent>
                    <TaskDetails task={task} />
                  </CollapsibleContent>
                </Collapsible>
              ))}
            </div>
          )}
        </CardContent>
        {tasks.length > 0 && (
          <CardFooter className="px-3 py-2">
            <p className="text-xs text-muted-foreground">{t('点击任务查看输出')}</p>
          </CardFooter>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
