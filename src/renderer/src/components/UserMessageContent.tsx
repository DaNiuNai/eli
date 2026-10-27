import { useLayoutEffect, useRef, useState } from 'react'
import { Bubble, BubbleContent } from '@renderer/components/ui/bubble'
import { Button } from '@renderer/components/ui/button'
import { ChatAttachments } from './ChatAttachments'
import { useLanguage } from '@renderer/hooks/use-language'
import { parseChatAttachmentMessage } from '../../../shared/chat-attachments'

export function UserMessageContent({ text }: { text: string }): React.JSX.Element {
  const { t } = useLanguage()
  const content = parseChatAttachmentMessage(text)
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const body = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const element = body.current
    if (!element) return
    const measure = (): void => setOverflows(element.scrollHeight > element.clientHeight + 1)
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    measure()
    return () => observer.disconnect()
  }, [content.text])

  return (
    <div className="user-message-content">
      {content.attachments.length > 0 && <ChatAttachments attachments={content.attachments} />}
      {content.text && (
        <Bubble variant="secondary" align="end">
          <BubbleContent>
            <div className="user-message-text" data-expanded={expanded}>
              <div ref={body} className="user-message-text-body whitespace-pre-wrap">
                {content.text}
              </div>
              {(overflows || expanded) && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-expanded={expanded}
                  onClick={() => setExpanded((value) => !value)}
                >
                  {t(expanded ? '收起' : '展开更多')}
                </Button>
              )}
            </div>
          </BubbleContent>
        </Bubble>
      )}
    </div>
  )
}
