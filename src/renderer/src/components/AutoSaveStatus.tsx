import { useSyncExternalStore } from 'react'
import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import { Button } from '@renderer/components/ui/button'
import { Spinner } from '@renderer/components/ui/spinner'
import { useLanguage } from '@renderer/hooks/use-language'
import { autoSaveFeedback } from '@renderer/lib/auto-save-feedback'

export function AutoSaveStatus(): React.JSX.Element {
  const { t } = useLanguage()
  const state = useSyncExternalStore(autoSaveFeedback.subscribe, autoSaveFeedback.getSnapshot)
  if (state.status === 'error') {
    return (
      <Alert variant="destructive" className="max-h-40 overflow-y-auto">
        <AlertDescription className="flex flex-col gap-3">
          {state.failures.map((failure) => (
            <div key={failure.id} className="flex min-w-0 flex-col items-start gap-1">
              <span className="w-full break-words [overflow-wrap:anywhere]">
                {t(failure.error ?? '自动保存失败，请重试。')}
              </span>
              <Button variant="ghost" size="xs" onClick={failure.retry}>
                {t('重试')}
              </Button>
            </div>
          ))}
        </AlertDescription>
      </Alert>
    )
  }
  return (
    <p
      role="status"
      aria-atomic="true"
      className="flex items-center gap-2 text-xs text-muted-foreground"
    >
      {state.status === 'saving' && <Spinner aria-hidden="true" />}
      {t(
        state.status === 'saved'
          ? '已自动保存'
          : state.status === 'saving'
            ? '正在自动保存…'
            : state.status === 'pending'
              ? '等待自动保存…'
              : '配置与数据保存在 ~/.eli'
      )}
    </p>
  )
}
