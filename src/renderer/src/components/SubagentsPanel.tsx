import { useState } from 'react'
import { ArrowDownIcon, BotIcon, NetworkIcon, SendIcon, SquareIcon, XIcon } from 'lucide-react'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Field, FieldLabel } from '@renderer/components/ui/field'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport
} from '@renderer/components/ui/message-scroller'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Textarea } from '@renderer/components/ui/textarea'
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle
} from '@renderer/components/ui/trace'
import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import { ChatMessage } from './ChatMessage'
import { TaskPanelSection } from './TaskPanelSection'
import { useLanguage } from '@renderer/hooks/use-language'
import { buildChatEntries, type ToolResult } from '@renderer/lib/chat-entries'
import {
  isSubagentActive,
  rootAgentId,
  type SubagentAction,
  type SubagentSnapshot,
  type SubagentStatus
} from '../../../shared/subagents'

const statusLabels: Record<SubagentStatus, string> = {
  starting: '正在启动',
  running: '运行中',
  waiting: '等待中',
  completed: '已完成',
  failed: '执行失败',
  interrupted: '已中断'
}

function AgentTree({
  agents,
  parentId,
  onSelect
}: {
  agents: SubagentSnapshot[]
  parentId: string
  onSelect: (id: string) => void
}): React.JSX.Element {
  const { t } = useLanguage()
  return (
    <Trace>
      {agents
        .filter((agent) => agent.parentId === parentId)
        .map((agent) => (
          <TraceCollapsible key={agent.id}>
            <TraceCollapsibleTrigger title={agent.task}>
              <TraceLine
                status={
                  agent.status === 'failed'
                    ? 'error'
                    : isSubagentActive(agent)
                      ? 'running'
                      : undefined
                }
              >
                <TraceIcon>
                  <BotIcon />
                </TraceIcon>
                <TraceTitle>{agent.taskName}</TraceTitle>
                <TraceDescription>{t(statusLabels[agent.status])}</TraceDescription>
              </TraceLine>
            </TraceCollapsibleTrigger>
            <TraceCollapsibleContent>
              <div className="flex min-w-0 flex-col gap-2 pb-2">
                <p className="line-clamp-3 text-xs whitespace-pre-wrap break-words">{agent.task}</p>
                <Button variant="outline" size="sm" onClick={() => onSelect(agent.id)}>
                  {t('查看子 Agent 对话')}
                </Button>
                <AgentTree agents={agents} parentId={agent.id} onSelect={onSelect} />
              </div>
            </TraceCollapsibleContent>
          </TraceCollapsible>
        ))}
    </Trace>
  )
}

export function SubagentsPanel({
  agents,
  disabled,
  onControl
}: {
  agents: SubagentSnapshot[]
  disabled: boolean
  onControl: (action: SubagentAction) => Promise<boolean>
}): React.JSX.Element | null {
  const { t } = useLanguage()
  const [selected, setSelected] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)
  const agent = agents.find((entry) => entry.id === selected)
  const draft = selected ? (drafts[selected] ?? '') : ''
  const snapshot = agent?.snapshot
  const messages = snapshot?.messages ?? []
  const entries = buildChatEntries(
    messages,
    snapshot?.activeThinking,
    snapshot?.hideThinkingBlock,
    snapshot?.response.toolCallDrafts
  )
  const results = new Map<string, ToolResult>()
  for (const message of messages)
    if (message.role === 'toolResult') results.set(message.toolCallId, message)

  async function control(action: SubagentAction): Promise<void> {
    if (pending || disabled) return
    setPending(true)
    try {
      if (await onControl(action)) {
        if (action.type !== 'interrupt')
          setDrafts((current) => ({ ...current, [action.target]: '' }))
      }
    } finally {
      setPending(false)
    }
  }

  if (!agents.length) return null
  const running = agents.filter(isSubagentActive).length
  return (
    <>
      <TaskPanelSection
        title={t('子 Agent')}
        description={t('{count} 运行中', { count: running })}
        count={agents.length}
        icon={NetworkIcon}
      >
        <div className="px-2 pb-2">
          <AgentTree agents={agents} parentId={rootAgentId} onSelect={setSelected} />
        </div>
      </TaskPanelSection>
      <Dialog
        open={!!agent}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="flex h-[min(820px,90dvh)] w-[min(1120px,94vw)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
        >
          <DialogHeader className="shrink-0 border-b p-6 pr-14">
            <DialogTitle className="truncate">{agent?.id ?? t('子 Agent')}</DialogTitle>
            <DialogDescription className="max-h-24 overflow-auto whitespace-pre-wrap break-words">
              {agent?.task}
            </DialogDescription>
            {agent && (
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={agent.status === 'failed' ? 'destructive' : 'secondary'}>
                  {t(statusLabels[agent.status])}
                </Badge>
                {snapshot?.model && (
                  <span className="text-xs text-muted-foreground">
                    {snapshot.model.provider}/{snapshot.model.id}
                  </span>
                )}
                {isSubagentActive(agent) && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={disabled || pending}
                    onClick={() => void control({ type: 'interrupt', target: agent.id })}
                  >
                    <SquareIcon data-icon="inline-start" />
                    {t('中断子 Agent')}
                  </Button>
                )}
              </div>
            )}
          </DialogHeader>
          <MessageScrollerProvider key={agent?.id} autoScroll>
            <MessageScroller className="min-h-0 flex-1">
              <MessageScrollerViewport aria-label={t('子 Agent 对话')}>
                <MessageScrollerContent className="gap-5 p-6">
                  {agent?.error && (
                    <MessageScrollerItem messageId="agent-error">
                      <Alert variant="destructive">
                        <AlertDescription>{t(agent.error)}</AlertDescription>
                      </Alert>
                    </MessageScrollerItem>
                  )}
                  {entries.map((entry) => (
                    <MessageScrollerItem
                      key={entry.id}
                      messageId={entry.id}
                      scrollAnchor={entry.role === 'user'}
                    >
                      <ChatMessage
                        entry={entry}
                        tools={snapshot?.tools ?? {}}
                        results={results}
                        running={!!snapshot?.running && entry === entries.at(-1)}
                      />
                    </MessageScrollerItem>
                  ))}
                  {!entries.length && agent?.result && (
                    <MessageScrollerItem messageId="agent-result">
                      <p className="whitespace-pre-wrap break-words">{agent.result}</p>
                    </MessageScrollerItem>
                  )}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton aria-label={t('跳转到最新消息')}>
                <ArrowDownIcon />
              </MessageScrollerButton>
            </MessageScroller>
          </MessageScrollerProvider>
          {agent && (
            <div className="flex shrink-0 flex-col gap-2 border-t px-6 py-4">
              <Field>
                <FieldLabel htmlFor="subagent-task">
                  {t('向子 Agent 发送消息或追加任务')}
                </FieldLabel>
                <Textarea
                  id="subagent-task"
                  value={draft}
                  maxLength={100000}
                  disabled={disabled || pending || !snapshot}
                  onChange={(event) =>
                    setDrafts((current) => ({ ...current, [agent.id]: event.target.value }))
                  }
                />
              </Field>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  disabled={disabled || pending || !snapshot || !draft.trim()}
                  onClick={() =>
                    void control({ type: 'message', target: agent.id, message: draft })
                  }
                >
                  {t('仅发消息')}
                </Button>
                <Button
                  disabled={disabled || pending || !snapshot || !draft.trim()}
                  onClick={() =>
                    void control({ type: 'followup', target: agent.id, message: draft })
                  }
                >
                  <SendIcon data-icon="inline-start" />
                  {t('追加任务')}
                </Button>
              </div>
            </div>
          )}
          <DialogClose
            render={<Button variant="ghost" size="icon-sm" className="absolute right-3 top-3" />}
            aria-label={t('关闭')}
          >
            <XIcon />
          </DialogClose>
        </DialogContent>
      </Dialog>
    </>
  )
}
