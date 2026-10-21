import { useCallback } from 'react'
import { Field, FieldGroup, FieldLabel } from '@renderer/components/ui/field'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea
} from '@renderer/components/ui/input-group'
import { useLanguage } from '@renderer/hooks/use-language'

export function MessageEditor({
  value,
  busy,
  onChange,
  onCancel,
  onSend
}: {
  value: string
  busy: boolean
  onChange: (value: string) => void
  onCancel: () => void
  onSend: () => void
}): React.JSX.Element {
  const { t } = useLanguage()
  const focusEditor = useCallback((element: HTMLTextAreaElement | null): void => {
    element?.focus({ preventScroll: true })
  }, [])
  return (
    <form
      className="w-full"
      onSubmit={(event) => {
        event.preventDefault()
        if (!busy && value.trim()) onSend()
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel className="sr-only">{t('编辑消息')}</FieldLabel>
          <InputGroup className="rounded-2xl">
            <InputGroupTextarea
              ref={focusEditor}
              aria-label={t('编辑消息')}
              value={value}
              disabled={busy}
              maxLength={100000}
              className="max-h-80 min-h-24 px-4 py-3"
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.keyCode === 229) return
                if (event.key === 'Escape' && !busy) {
                  event.preventDefault()
                  onCancel()
                } else if (event.key === 'Enter' && event.ctrlKey && !busy && value.trim()) {
                  event.preventDefault()
                  onSend()
                }
              }}
            />
            <InputGroupAddon align="block-end" className="justify-end gap-2">
              <InputGroupButton variant="secondary" size="sm" disabled={busy} onClick={onCancel}>
                {t('取消')}
              </InputGroupButton>
              <InputGroupButton
                type="submit"
                size="sm"
                variant="default"
                disabled={busy || !value.trim()}
              >
                {t(busy ? '正在发送…' : '发送')}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </Field>
      </FieldGroup>
    </form>
  )
}
