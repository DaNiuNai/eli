import { useState } from 'react'
import { Trash2Icon } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@renderer/components/ui/alert-dialog'
import { SidebarMenuAction } from '@renderer/components/ui/sidebar'
import { Spinner } from '@renderer/components/ui/spinner'
import { useLanguage } from '@renderer/hooks/use-language'
import type { SavedSession } from '../../../shared/pi-library'

export function DeleteSessionAction({
  session,
  disabled,
  onDelete
}: {
  session: SavedSession
  disabled: boolean
  onDelete: (session: SavedSession) => Promise<void>
}): React.JSX.Element {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove(): Promise<void> {
    if (disabled || deleting) return
    setDeleting(true)
    setError(null)
    try {
      await onDelete(session)
      setOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (deleting) return
        setOpen(next)
        setError(null)
      }}
    >
      <AlertDialogTrigger
        render={
          <SidebarMenuAction className="opacity-0 group-hover/session:opacity-100 focus-visible:opacity-100" />
        }
        aria-label={t('删除会话：{title}', { title: session.title })}
        title={t('删除会话')}
        disabled={disabled}
      >
        <Trash2Icon />
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('删除此会话？')}</AlertDialogTitle>
          <AlertDialogDescription className="break-words">
            {t('“{title}”将移入系统回收站，可从回收站恢复。', { title: session.title })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {t(error)}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>{t('取消')}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={disabled || deleting}
            onClick={() => void remove()}
          >
            {deleting && <Spinner data-icon="inline-start" />}
            {t(deleting ? '正在删除…' : '删除会话')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
