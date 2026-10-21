import { useEffect, useState } from 'react'
import { getChatImageSource } from '../../../shared/chat-images'
import { useLanguage } from '@renderer/hooks/use-language'

export function MarkdownImage({
  source,
  alt,
  title
}: {
  source: string
  alt?: string
  title?: string
}): React.JSX.Element {
  const { t } = useLanguage()
  const image = getChatImageSource(source)
  const kind = image?.kind
  const value = image?.value
  const [local, setLocal] = useState<{ source: string; url: string } | null>(null)
  const [failedSource, setFailedSource] = useState<string | null>(null)
  const label = alt || t('图片')
  const canReadLocal = typeof window !== 'undefined' && !!window.api?.readImage
  const failed = !image || failedSource === source || (kind === 'local' && !canReadLocal)
  const url = kind === 'url' ? value : local?.source === source ? local.url : undefined

  useEffect(() => {
    if (kind !== 'local' || !value || !canReadLocal) return
    let active = true
    void window.api.readImage(value).then(
      (url) => {
        if (active) {
          setLocal({ source, url })
          setFailedSource(null)
        }
      },
      () => {
        if (active) setFailedSource(source)
      }
    )
    return () => {
      active = false
    }
  }, [source, kind, value, canReadLocal])

  return (
    <span className="chat-image">
      {failed ? (
        <span className="text-xs text-muted-foreground" title={source}>
          {t('图片加载失败：{alt}', { alt: label })}
        </span>
      ) : url ? (
        <img
          src={url}
          alt={label}
          title={title}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedSource(source)}
        />
      ) : (
        <span role="status" className="text-xs text-muted-foreground">
          {t('正在加载图片…')}
        </span>
      )}
    </span>
  )
}
