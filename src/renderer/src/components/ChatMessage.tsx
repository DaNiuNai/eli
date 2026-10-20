import { BrainIcon, TerminalIcon } from 'lucide-react'
import type { PiMessage, PiToolEvent } from '../../../shared/pi'
import { Bubble, BubbleContent } from '@renderer/components/ui/bubble'
import { Message, MessageContent, MessageHeader } from '@renderer/components/ui/message'
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle
} from '@renderer/components/ui/trace'
import { CodeBlock, CodeBlockContent } from '@renderer/components/ui/code-block'
import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import { ChatMarkdown } from './ChatMarkdown'

type Assistant = Extract<PiMessage, { role: 'assistant' }>
type ToolCall = Extract<Assistant['content'][number], { type: 'toolCall' }>

function ToolCallView({
  call,
  event,
  result,
  running
}: {
  call: ToolCall
  event?: PiToolEvent
  result?: Extract<PiMessage, { role: 'toolResult' }>
  running: boolean
}): React.JSX.Element {
  const finished = event?.type === 'tool_execution_end' || !!result
  const failed = (event?.type === 'tool_execution_end' && event.isError) || result?.isError
  const output = result?.content
    .map((part) => (part.type === 'text' ? part.text : '[图片输出]'))
    .join('\n')
  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>
        <TraceLine status={failed ? 'error' : !finished && running ? 'running' : undefined}>
          <TraceIcon>
            <TerminalIcon />
          </TraceIcon>
          <TraceTitle>
            {failed ? '执行失败' : finished ? '已执行' : running ? '正在执行' : '未完成'} ·{' '}
            {call.name}
          </TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <div className="flex min-w-0 flex-col gap-2">
          <CodeBlock size="sm">
            <CodeBlockContent wrap className="max-h-48">
              {JSON.stringify(call.arguments, null, 2)}
            </CodeBlockContent>
          </CodeBlock>
          {output && (
            <CodeBlock size="sm" variant={failed ? 'destructive' : 'default'}>
              <CodeBlockContent wrap className="max-h-64">
                {output}
              </CodeBlockContent>
            </CodeBlock>
          )}
        </div>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  )
}

export function ChatMessage({
  message,
  messages,
  tools,
  running
}: {
  message: PiMessage
  messages: PiMessage[]
  tools: Record<string, PiToolEvent>
  running: boolean
}): React.JSX.Element | null {
  if (message.role === 'toolResult') return null
  if (message.role !== 'assistant' && message.role !== 'user') return null
  const user = message.role === 'user'
  const content =
    typeof message.content === 'string'
      ? [{ type: 'text' as const, text: message.content }]
      : message.content
  const groups: Array<{ kind: 'text' | 'trace'; parts: Assistant['content'] }> = []
  for (const part of content) {
    if (part.type === 'image') continue
    const kind = part.type === 'text' ? 'text' : 'trace'
    const last = groups.at(-1)
    if (last?.kind === kind) last.parts.push(part)
    else groups.push({ kind, parts: [part] })
  }

  return (
    <Message align={user ? 'end' : 'start'}>
      <MessageContent>
        <MessageHeader>{user ? '你' : 'pi'}</MessageHeader>
        {groups.map((group, groupIndex) =>
          group.kind === 'text' ? (
            <Bubble
              key={groupIndex}
              variant={user ? 'secondary' : 'ghost'}
              align={user ? 'end' : 'start'}
            >
              <BubbleContent>
                {user ? (
                  <div className="whitespace-pre-wrap">
                    {group.parts.map((part) => (part.type === 'text' ? part.text : '')).join('\n')}
                  </div>
                ) : (
                  <ChatMarkdown
                    text={group.parts
                      .map((part) => (part.type === 'text' ? part.text : ''))
                      .join('\n')}
                  />
                )}
              </BubbleContent>
            </Bubble>
          ) : (
            <Trace key={groupIndex}>
              {group.parts.map((part, index) =>
                part.type === 'thinking' ? (
                  <TraceCollapsible key={index}>
                    <TraceCollapsibleTrigger>
                      <TraceLine
                        status={
                          running &&
                          message.role === 'assistant' &&
                          message.stopReason === 'pending'
                            ? 'running'
                            : undefined
                        }
                      >
                        <TraceIcon>
                          <BrainIcon />
                        </TraceIcon>
                        <TraceTitle>思考过程</TraceTitle>
                      </TraceLine>
                    </TraceCollapsibleTrigger>
                    <TraceCollapsibleContent>
                      <ChatMarkdown text={part.thinking} />
                    </TraceCollapsibleContent>
                  </TraceCollapsible>
                ) : part.type === 'toolCall' ? (
                  <ToolCallView
                    key={part.id}
                    call={part}
                    event={tools[part.id]}
                    result={messages.find(
                      (entry): entry is Extract<PiMessage, { role: 'toolResult' }> =>
                        entry.role === 'toolResult' && entry.toolCallId === part.id
                    )}
                    running={running}
                  />
                ) : null
              )}
            </Trace>
          )
        )}
        {message.role === 'assistant' && message.stopReason === 'error' && (
          <Alert variant="destructive">
            <AlertDescription>{message.errorMessage || '回复失败，请重试。'}</AlertDescription>
          </Alert>
        )}
        {message.role === 'assistant' && message.stopReason === 'aborted' && (
          <span className="text-xs text-muted-foreground">已停止生成</span>
        )}
      </MessageContent>
    </Message>
  )
}
