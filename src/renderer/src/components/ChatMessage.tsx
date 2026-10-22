import type { PiToolEvent } from '../../../shared/pi'
import { Bubble, BubbleContent } from '@renderer/components/ui/bubble'
import { Message, MessageContent } from '@renderer/components/ui/message'
import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import { Trace, TraceLine, TraceTitle } from '@renderer/components/ui/trace'
import type { ChatEntry, ToolResult } from '@renderer/lib/chat-entries'
import { ChatMarkdown } from './ChatMarkdown'
import { ToolActivity } from './ToolActivity'
import { useLanguage } from '@renderer/hooks/use-language'
import { MessageActions } from './MessageActions'
import { MessageEditor } from './MessageEditor'

export function ChatMessage({
  entry,
  results,
  tools,
  running,
  responseStatus = null,
  actionDisabled = true,
  editing,
  onStartEdit = () => {},
  onEditChange = () => {},
  onEditCancel = () => {},
  onEditSend = () => {},
  onFork = () => {}
}: {
  entry: ChatEntry
  results: Map<string, ToolResult>
  tools: Record<string, PiToolEvent>
  running: boolean
  responseStatus?: string | null
  actionDisabled?: boolean
  editing?: { text: string; busy: boolean }
  onStartEdit?: (text: string) => void
  onEditChange?: (text: string) => void
  onEditCancel?: () => void
  onEditSend?: () => void
  onFork?: () => void
}): React.JSX.Element {
  const { t } = useLanguage()
  const user = entry.role === 'user'
  const text = entry.groups
    .flatMap((group) => (group.kind === 'text' ? [group.text] : []))
    .join('\n\n')

  return (
    <Message className="chat-message" align={user ? 'end' : 'start'}>
      <MessageContent>
        {editing && user ? (
          <MessageEditor
            value={editing.text}
            busy={editing.busy}
            onChange={onEditChange}
            onCancel={onEditCancel}
            onSend={onEditSend}
          />
        ) : (
          entry.groups.map((group) => {
            switch (group.kind) {
              case 'text':
                return (
                  <Bubble
                    key={group.id}
                    variant={user ? 'secondary' : 'ghost'}
                    align={user ? 'end' : 'start'}
                  >
                    <BubbleContent>
                      {user ? (
                        <div className="whitespace-pre-wrap">{group.text}</div>
                      ) : (
                        <ChatMarkdown text={group.text} />
                      )}
                    </BubbleContent>
                  </Bubble>
                )
              case 'trace':
                return (
                  <ToolActivity
                    key={group.id}
                    parts={group.parts}
                    results={results}
                    tools={tools}
                    running={running}
                  />
                )
              case 'error':
                return (
                  <Alert key={group.id} variant="destructive">
                    <AlertDescription>{t(group.text)}</AlertDescription>
                  </Alert>
                )
              case 'aborted':
                return (
                  <span key={group.id} className="text-xs text-muted-foreground">
                    {t('已停止生成')}
                  </span>
                )
            }
          })
        )}
        {responseStatus && (
          <Trace role="status" aria-live="polite">
            <TraceLine status="running">
              <TraceTitle>{t(responseStatus)}</TraceTitle>
            </TraceLine>
          </Trace>
        )}
        {!editing && (user || !!text.trim()) && (
          <MessageActions
            text={text}
            user={user}
            disabled={actionDisabled}
            onEdit={() => onStartEdit(text)}
            onFork={onFork}
          />
        )}
      </MessageContent>
    </Message>
  )
}
