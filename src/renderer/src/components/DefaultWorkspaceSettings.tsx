import { useState, useSyncExternalStore } from 'react'
import { FolderOpenIcon, RotateCcwIcon } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel
} from '@renderer/components/ui/field'
import { useLanguage } from '@renderer/hooks/use-language'
import { useAutoSave } from '@renderer/hooks/use-auto-save'
import {
  getAppPreferences,
  getAppPreferencesError,
  subscribeAppPreferences,
  updateAppPreferences
} from '@renderer/lib/app-preferences'

export function DefaultWorkspaceSettings(): React.JSX.Element {
  const { t, language } = useLanguage()
  const { defaultWorkingDirectory } = useSyncExternalStore(
    subscribeAppPreferences,
    getAppPreferences
  )
  const [choosing, setChoosing] = useState(false)
  const [selectionError, setSelectionError] = useState<string | null>(null)
  const save = useAutoSave<string | null>(async (_key, directory) => {
    if (!(await updateAppPreferences({ defaultWorkingDirectory: directory }))) {
      throw new Error(getAppPreferencesError() ?? '无法保存默认工作目录')
    }
  }, 'default-workspace')
  const state = save.states.directory
  const directory = state ? state.value : defaultWorkingDirectory
  const error = selectionError ?? (state?.status === 'error' ? state.error : null)

  async function chooseDirectory(): Promise<void> {
    setChoosing(true)
    setSelectionError(null)
    try {
      const selected = await window.appPreferences.chooseDirectory(language)
      if (selected) save.update('directory', selected, 0)
    } catch (cause) {
      setSelectionError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setChoosing(false)
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <FieldGroup className="gap-0">
        <Field
          orientation="responsive"
          className="settings-row"
          data-disabled={choosing}
          data-invalid={!!error}
        >
          <FieldContent className="min-w-0">
            <FieldLabel htmlFor="settings-default-workspace">{t('默认工作目录')}</FieldLabel>
            <FieldDescription id="settings-default-workspace-description">
              {t('启动时使用此目录。修改自动保存，并在下次启动时生效。')}
            </FieldDescription>
            <FieldDescription className="break-all">
              {directory ?? t('文档目录下的 eli 文件夹')}
            </FieldDescription>
            {error && <FieldError>{t(error)}</FieldError>}
          </FieldContent>
          <FieldGroup className="settings-control shrink-0 flex-row justify-end gap-2">
            <Button
              id="settings-default-workspace"
              variant="outline"
              size="sm"
              disabled={choosing}
              aria-invalid={!!error}
              aria-describedby="settings-default-workspace-description"
              onClick={() => void chooseDirectory()}
            >
              <FolderOpenIcon data-icon="inline-start" />
              {t('选择文件夹')}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={choosing || directory === null}
              aria-label={`${t('恢复默认值')} · ${t('默认工作目录')}`}
              title={t('恢复默认值')}
              onClick={() => {
                setSelectionError(null)
                save.update('directory', null, 0)
              }}
            >
              <RotateCcwIcon />
            </Button>
          </FieldGroup>
        </Field>
      </FieldGroup>
    </section>
  )
}
