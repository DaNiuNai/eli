import { RotateCcwIcon } from 'lucide-react'
import { AutoSaveStatus } from '@renderer/components/AutoSaveStatus'
import { Button } from '@renderer/components/ui/button'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel
} from '@renderer/components/ui/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { useLanguage } from '@renderer/hooks/use-language'
import { useProviders } from '@renderer/hooks/use-providers'
import type { AutoSaveState } from '@renderer/lib/auto-save'

export function DefaultModelSetting({
  id,
  selected,
  disabled,
  resetDisabled,
  state,
  onChange,
  onRetry
}: {
  id: string
  selected: { provider: string; id: string } | null
  disabled: boolean
  resetDisabled: boolean
  state?: Pick<AutoSaveState<unknown>, 'status' | 'error'>
  onChange: (model: { provider: string; id: string } | null) => void
  onRetry: () => void
}): React.JSX.Element {
  const { t } = useLanguage()
  const { data, loading, error } = useProviders(0)
  const models = (data?.providers ?? [])
    .filter(
      (provider) =>
        provider.enabled &&
        (provider.authMode === 'oauth' ? provider.oauthConfigured : provider.apiKeyConfigured)
    )
    .flatMap((provider) =>
      provider.models
        .filter((model) => model.enabled)
        .map((model) => ({
          value: JSON.stringify([provider.id, model.id]),
          label: `${provider.name} / ${model.name}`,
          model: { provider: provider.id, id: model.id }
        }))
    )
  const value = selected ? JSON.stringify([selected.provider, selected.id]) : 'auto'
  const missing = !!selected && !models.some((model) => model.value === value)
  const unavailable = missing && !!selected.provider && !!selected.id && !loading && !error
  const items = [
    { value: 'auto', label: t('自动选择') },
    ...models,
    ...(missing
      ? [
          {
            value,
            label: `${selected.provider || t('自动选择')} / ${selected.id || t('自动选择')}${unavailable ? ` · ${t('不可用')}` : ''}`
          }
        ]
      : [])
  ]
  const invalid = !!error || state?.status === 'error'
  const descriptionId = `${id}-description`

  return (
    <Field
      orientation="responsive"
      className="settings-row"
      data-disabled={disabled || loading}
      data-invalid={invalid}
    >
      <FieldContent className="min-w-0">
        <FieldLabel htmlFor={id}>{t('默认模型')}</FieldLabel>
        <FieldDescription id={descriptionId}>
          {t('新对话使用的默认模型，选择后同时设置供应商和模型，不会改变已有对话的模型。')}
        </FieldDescription>
        <AutoSaveStatus state={state} onRetry={onRetry} />
      </FieldContent>
      <FieldGroup className="settings-control shrink-0 gap-3">
        <div className="flex w-full items-start gap-2">
          <Select
            items={items}
            value={value}
            disabled={disabled || loading}
            onValueChange={(next) => {
              if (next === 'auto') onChange(null)
              else {
                const model = models.find((model) => model.value === next)
                if (model) onChange(model.model)
              }
            }}
          >
            <SelectTrigger
              id={id}
              className="min-w-0 flex-1"
              aria-describedby={descriptionId}
              aria-invalid={invalid}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {items.map((item) => (
                  <SelectItem
                    key={item.value}
                    value={item.value}
                    disabled={missing && item.value === value}
                  >
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={resetDisabled}
            aria-label={`${t('恢复默认值')} · ${t('默认模型')}`}
            title={t('恢复默认值')}
            onClick={() => onChange(null)}
          >
            <RotateCcwIcon />
          </Button>
        </div>
        {error && <FieldError>{t(error)}</FieldError>}
        {unavailable && (
          <FieldDescription>
            {t('所选默认模型当前不可用，请在模型供应商中检查配置或重新选择。')}
          </FieldDescription>
        )}
      </FieldGroup>
    </Field>
  )
}
