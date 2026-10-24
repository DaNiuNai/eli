import { useSyncExternalStore } from 'react'
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
import { useAutoSave } from '@renderer/hooks/use-auto-save'
import {
  getAppPreferences,
  getAppPreferencesError,
  subscribeAppPreferences,
  updateAppPreferences
} from '@renderer/lib/app-preferences'
import type { AutoApprovalModel } from '../../../shared/tool-approval'

export function AutoApprovalSettings(): React.JSX.Element {
  const { t } = useLanguage()
  const { autoApprovalModel } = useSyncExternalStore(subscribeAppPreferences, getAppPreferences)
  const { data, loading, error } = useProviders(0)
  const save = useAutoSave<AutoApprovalModel | null>(async (_key, model) => {
    if (!(await updateAppPreferences({ autoApprovalModel: model }))) {
      throw new Error(getAppPreferencesError() ?? '无法保存自动批准模型')
    }
  }, 'auto-approval')
  const state = save.states.model
  const selected = state ? state.value : autoApprovalModel
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
  const value = selected ? JSON.stringify([selected.provider, selected.id]) : 'current'
  const unavailable =
    !!selected && !loading && !error && !models.some((model) => model.value === value)
  const items = [
    { value: 'current', label: t('跟随当前会话模型') },
    ...models,
    ...(unavailable
      ? [{ value, label: `${selected.provider} / ${selected.id} · ${t('不可用')}` }]
      : [])
  ]
  return (
    <section className="flex flex-col gap-6">
      <FieldGroup className="gap-0">
        <Field
          orientation="responsive"
          className="settings-row"
          data-disabled={loading}
          data-invalid={!!error || state?.status === 'error'}
        >
          <FieldContent className="min-w-0">
            <FieldLabel htmlFor="settings-auto-approval-model">{t('自动批准模型')}</FieldLabel>
            <FieldDescription id="settings-auto-approval-description">
              {t('审核工具调用使用的模型，可独立于当前会话选择。修改后从下一次审核生效。')}
            </FieldDescription>
            <FieldDescription>
              {t('自动审核会产生额外模型请求；无法判断时转为人工审批。')}
            </FieldDescription>
          </FieldContent>
          <FieldGroup className="settings-control shrink-0 gap-3">
            <Select
              items={items}
              value={value}
              disabled={loading}
              onValueChange={(next) => {
                if (next === 'current') save.update('model', null, 0)
                else {
                  const model = models.find((model) => model.value === next)
                  if (model) save.update('model', model.model, 0)
                }
              }}
            >
              <SelectTrigger
                id="settings-auto-approval-model"
                className="w-full"
                aria-describedby="settings-auto-approval-description"
                aria-invalid={!!error || state?.status === 'error'}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {items.map((item) => (
                    <SelectItem
                      key={item.value}
                      value={item.value}
                      disabled={unavailable && item.value === value}
                    >
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {error && <FieldError>{t(error)}</FieldError>}
            {unavailable && (
              <FieldDescription>
                {t('所选模型当前不可用，自动审核将转为人工审批。')}
              </FieldDescription>
            )}
          </FieldGroup>
        </Field>
      </FieldGroup>
    </section>
  )
}
