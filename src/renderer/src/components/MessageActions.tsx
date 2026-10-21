import { useEffect, useState } from 'react'
import { CheckIcon, CopyIcon, GitForkIcon, PencilIcon } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { MessageFooter } from '@renderer/components/ui/message'
import { useLanguage } from '@renderer/hooks/use-language'

export function MessageActions({
  text,
  user,
  disabled,
  onEdit,
  onFork
}: {
  text: string
  user: boolean
  disabled: boolean
  onEdit: () => void
  onFork: () => void
}): React.JSX.Element {
  const { t } = useLanguage()
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
  useEffect(() => {
    if (copyState === 'idle') return
    const timer = setTimeout(() => setCopyState('idle'), 2000)
    return () => clearTimeout(timer)
  }, [copyState])

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
      setCopyState('copied')
    } catch {
      setCopyState('error')
    }
  }

  return (
    <MessageFooter className="message-actions gap-1" aria-label={t('消息操作')}>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={t(copyState === 'copied' ? '已复制' : '复制消息')}
        title={t(copyState === 'copied' ? '已复制' : '复制消息')}
        disabled={!text}
        onClick={() => void copy()}
      >
        {copyState === 'copied' ? <CheckIcon /> : <CopyIcon />}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={t(user ? '编辑消息' : '分叉会话')}
        title={t(user ? '编辑消息' : '分叉会话')}
        disabled={disabled}
        onClick={user ? onEdit : onFork}
      >
        {user ? <PencilIcon /> : <GitForkIcon />}
      </Button>
      <span className="sr-only" role="status">
        {copyState === 'copied' ? t('已复制') : ''}
      </span>
      {copyState === 'error' && <span role="status">{t('复制失败，请重试')}</span>}
    </MessageFooter>
  )
}
