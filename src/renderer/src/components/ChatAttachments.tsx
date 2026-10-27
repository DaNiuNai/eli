import { FileIcon, XIcon } from 'lucide-react'
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle
} from '@renderer/components/ui/attachment'
import { MarkdownImage } from './MarkdownImage'
import { useLanguage } from '@renderer/hooks/use-language'
import { imageExtension } from '../../../shared/chat-images'
import { chatAttachmentName, type ChatDraftAttachment } from '../../../shared/chat-attachments'

export function ChatAttachments({
  attachments,
  onRemove
}: {
  attachments: ChatDraftAttachment[]
  onRemove?: (id: string) => void
}): React.JSX.Element {
  const { t } = useLanguage()
  return (
    <AttachmentGroup className="chat-attachments" role="list" aria-label={t('已添加的附件')}>
      {attachments.map((attachment, index) => {
        if (!imageExtension.test(attachment.path)) {
          const name = chatAttachmentName(attachment.path)
          return (
            <Attachment
              key={attachment.id}
              className="chat-file-attachment"
              role="listitem"
              aria-label={name}
              title={attachment.path}
            >
              <AttachmentMedia>
                <FileIcon />
              </AttachmentMedia>
              <AttachmentContent>
                <AttachmentTitle>{name}</AttachmentTitle>
              </AttachmentContent>
              {onRemove && (
                <AttachmentActions>
                  <AttachmentAction
                    type="button"
                    aria-label={t('移除文件 {name}', { name })}
                    title={t('移除文件 {name}', { name })}
                    onClick={() => onRemove(attachment.id)}
                  >
                    <XIcon />
                  </AttachmentAction>
                </AttachmentActions>
              )}
            </Attachment>
          )
        }
        const label = t('图片{number}', { number: index + 1 })
        return (
          <Attachment
            key={attachment.id}
            className="chat-attachment"
            orientation="vertical"
            role="listitem"
            aria-label={label}
            title={`${label} · ${attachment.path}`}
          >
            <AttachmentMedia variant="image" className="chat-attachment-media">
              <MarkdownImage source={attachment.path} alt={label} />
            </AttachmentMedia>
            {onRemove && (
              <>
                <span className="chat-attachment-number">{label}</span>
                <AttachmentActions className="chat-attachment-actions">
                  <AttachmentAction
                    type="button"
                    variant="secondary"
                    className="rounded-full"
                    aria-label={t('移除图片{number}', { number: index + 1 })}
                    title={t('移除图片{number}', { number: index + 1 })}
                    onClick={() => onRemove(attachment.id)}
                  >
                    <XIcon />
                  </AttachmentAction>
                </AttachmentActions>
              </>
            )}
          </Attachment>
        )
      })}
    </AttachmentGroup>
  )
}
