import { XIcon } from 'lucide-react'
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentMedia
} from '@renderer/components/ui/attachment'
import { MarkdownImage } from './MarkdownImage'
import { useLanguage } from '@renderer/hooks/use-language'
import type { ChatDraftImage } from '../../../shared/chat-images'

export function ChatImageAttachments({
  images,
  onRemove
}: {
  images: ChatDraftImage[]
  onRemove?: (id: string) => void
}): React.JSX.Element {
  const { t } = useLanguage()
  return (
    <div className="chat-attachments" role="list" aria-label={t('已添加的图片')}>
      {images.map((image, index) => {
        const label = t('图片{number}', { number: index + 1 })
        return (
          <Attachment
            key={image.id}
            className="chat-attachment"
            orientation="vertical"
            role="listitem"
            aria-label={label}
            title={`${label} · ${image.path}`}
          >
            <AttachmentMedia variant="image" className="chat-attachment-media">
              <MarkdownImage source={image.path} alt={label} />
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
                    onClick={() => onRemove(image.id)}
                  >
                    <XIcon />
                  </AttachmentAction>
                </AttachmentActions>
              </>
            )}
          </Attachment>
        )
      })}
    </div>
  )
}
