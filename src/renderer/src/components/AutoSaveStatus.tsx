import { Button } from '@renderer/components/ui/button'
import { FieldError } from '@renderer/components/ui/field'
import { Spinner } from '@renderer/components/ui/spinner'
import { useLanguage } from '@renderer/hooks/use-language'
import type { AutoSaveState } from '@renderer/lib/auto-save'

export function AutoSaveStatus({
  state,
  onRetry
}: {
  state?: Pick<AutoSaveState<unknown>, 'status' | 'error'>
  onRetry: () => void
}): React.JSX.Element | null {
  const { t } = useLanguage()
  if (!state) return null
  if (state.status === 'error') {
    return (
      <FieldError className="flex flex-wrap items-center gap-2">
        <span className="break-words">{t(state.error ?? '自动保存失败，请重试。')}</span>
        <Button variant="ghost" size="xs" onClick={onRetry}>
          {t('重试')}
        </Button>
      </FieldError>
    )
  }
  return (
    <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
      {state.status === 'saving' && <Spinner />}
      {t(
        state.status === 'saved'
          ? '已自动保存'
          : state.status === 'saving'
            ? '正在自动保存…'
            : '等待自动保存…'
      )}
    </p>
  )
}
