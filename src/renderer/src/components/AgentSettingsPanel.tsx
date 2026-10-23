import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { RotateCcwIcon } from 'lucide-react'
import { AutoSaveStatus } from '@renderer/components/AutoSaveStatus'
import { DefaultModelSetting } from '@renderer/components/DefaultModelSetting'
import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import { Button } from '@renderer/components/ui/button'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel
} from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import { Textarea } from '@renderer/components/ui/textarea'
import { Switch } from '@renderer/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@renderer/components/ui/empty'
import { Spinner } from '@renderer/components/ui/spinner'
import { useLanguage } from '@renderer/hooks/use-language'
import { useAutoSave } from '@renderer/hooks/use-auto-save'
import {
  agentSettingDefinitions,
  type AgentSettingDefinition,
  type AgentSettingsCategory,
  type AgentSettingsChange,
  type AgentSettingsSnapshot
} from '../../../shared/agent-settings'

type Draft = { text: string; reset?: boolean; provider?: string }

function format(value: unknown, field: AgentSettingDefinition): string {
  if (value === undefined) return ''
  if (field.kind === 'lines') return Array.isArray(value) ? value.join('\n') : ''
  if (field.kind === 'json') return JSON.stringify(value, null, 2)
  if (value === 'disabled' && field.kind === 'number') return '0'
  return String(value)
}

function parse(text: string, field: AgentSettingDefinition): unknown {
  if (field.kind === 'boolean') return text === 'true'
  if (field.kind === 'number') {
    const value = Number(text)
    if (!Number.isSafeInteger(value) || value < (field.min ?? 0))
      throw new Error(`${field.label}：请输入有效的非负整数`)
    return value
  }
  if (field.kind === 'lines')
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  if (field.kind === 'json') {
    try {
      return JSON.parse(text)
    } catch {
      throw new Error(`${field.label}：请输入有效的 JSON`)
    }
  }
  return text
}

export function AgentSettingsPanel({
  enabled,
  category,
  query,
  general
}: {
  enabled: boolean
  category: AgentSettingsCategory | 'general'
  query: string
  general: ReactNode
}): React.JSX.Element {
  const { t } = useLanguage()
  const id = useId()
  const [data, setData] = useState<AgentSettingsSnapshot | null>(null)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const scroll = useRef<HTMLDivElement>(null)
  const active = useRef(true)
  const latest = useRef<AgentSettingsSnapshot | null>(null)
  const autoSave = useAutoSave<Draft>(async (key, draft) => {
    const current = latest.current
    if (!current) throw new Error('正在加载设置')
    const field = agentSettingDefinitions.find((item) => item.key === key)!
    const reset = draft.reset || (!draft.text.trim() && !['boolean', 'lines'].includes(field.kind))
    const change: AgentSettingsChange = {
      key,
      ...(reset ? { reset: true } : { value: parse(draft.text, field) }),
      expected: current.values[key]
    }
    const changes: AgentSettingsChange[] =
      key === 'defaultModel'
        ? [
            {
              key: 'defaultProvider',
              ...(reset ? { reset: true } : { value: draft.provider }),
              expected: current.values.defaultProvider
            },
            change
          ]
        : [change]
    try {
      const result = await window.api.saveSettings(changes)
      latest.current = result
      if (active.current) setData(result)
    } catch (cause) {
      const result = await window.api.getSettings().catch(() => null)
      if (result) {
        latest.current = result
        if (active.current) setData(result)
      }
      throw cause
    }
  })

  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    let current = true
    void window.api
      .getSettings()
      .then((result) => {
        if (current) {
          latest.current = result
          setData(result)
          setError('')
        }
      })
      .catch((cause: unknown) => {
        if (current) setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      current = false
    }
  }, [enabled, reload])

  useEffect(() => {
    scroll.current?.scrollTo({ top: 0 })
  }, [category, query])

  function update(key: string, draft: Draft): void {
    const field = agentSettingDefinitions.find((item) => item.key === key)!
    autoSave.update(key, draft, draft.reset || ['boolean', 'select'].includes(field.kind) ? 0 : 400)
  }

  const search = query.trim().toLowerCase()
  const fields = agentSettingDefinitions.filter((field) => {
    if (['defaultProvider', 'enabledModels', 'modelThinkingLevels'].includes(field.key))
      return false
    const searchable =
      field.key === 'defaultModel'
        ? agentSettingDefinitions.filter((item) =>
            ['defaultProvider', 'defaultModel'].includes(item.key)
          )
        : [field]
    return search
      ? searchable.some((item) =>
          [
            item.key,
            item.label,
            item.description,
            item.section,
            t(item.label),
            t(item.description)
          ].some((value) => value.toLowerCase().includes(search))
        )
      : field.category === category
  })
  const sections = [...new Set(fields.map((field) => field.section))]

  if (!enabled || (category === 'general' && !search))
    return (
      <div ref={scroll} className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
        {general ?? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t('未找到设置')}</EmptyTitle>
              <EmptyDescription>{t('试试外观、登录或终端等 Eli 设置。')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    )

  return (
    <>
      <div ref={scroll} className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
        {general && <div className="mb-8">{general}</div>}
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{t(error)}</AlertDescription>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setReload((value) => value + 1)
              }}
            >
              {t('重新加载')}
            </Button>
          </Alert>
        )}
        {!data && !error ? (
          <div className="flex items-center gap-2 py-12 text-muted-foreground" role="status">
            <Spinner />
            {t('正在加载设置')}
          </div>
        ) : null}
        {data &&
          sections.map((section) => (
            <section key={section} className="mb-8 flex flex-col gap-2 last:mb-0">
              <h3 className="py-2 text-sm font-semibold">{t(section)}</h3>
              <FieldGroup className="gap-0">
                {fields
                  .filter((field) => field.section === section)
                  .map((field) => {
                    const state = autoSave.states[field.key]
                    const draft = state && state.status !== 'saved' ? state.value : undefined
                    if (field.key === 'defaultModel') {
                      const provider = draft?.reset
                        ? ''
                        : (draft?.provider ?? String(data.values.defaultProvider ?? ''))
                      const model = draft?.reset
                        ? ''
                        : (draft?.text ?? String(data.values.defaultModel ?? ''))
                      const customized =
                        data.values.defaultProvider !== undefined ||
                        data.values.defaultModel !== undefined
                      return (
                        <DefaultModelSetting
                          key={field.key}
                          id={`${id}-${field.key}`}
                          selected={provider || model ? { provider, id: model } : null}
                          disabled={!enabled}
                          resetDisabled={!enabled || (!customized && !draft) || !!draft?.reset}
                          state={state}
                          onChange={(selected) =>
                            autoSave.update(
                              field.key,
                              selected
                                ? { text: selected.id, provider: selected.provider }
                                : { text: '', reset: true },
                              0
                            )
                          }
                          onRetry={() => state && autoSave.update(field.key, state.value, 0)}
                        />
                      )
                    }
                    const inherited = field.defaultValue
                    const raw = data.values[field.key]
                    const value = draft?.reset ? inherited : (raw ?? inherited)
                    const text = draft && !draft.reset ? draft.text : format(value, field)
                    const disabled = !enabled
                    const invalid = state?.status === 'error'
                    const inputId = `${id}-${field.key}`
                    const descriptionId = `${inputId}-description`
                    const resetDisabled =
                      disabled || (raw === undefined && !draft) || !!draft?.reset
                    const source = raw !== undefined ? t('已自定义') : t('默认值')
                    return (
                      <Field
                        key={field.key}
                        orientation="responsive"
                        className="settings-row"
                        data-invalid={invalid}
                        data-disabled={disabled}
                      >
                        <FieldContent className="min-w-0">
                          <FieldLabel htmlFor={inputId}>{t(field.label)}</FieldLabel>
                          <FieldDescription id={descriptionId}>
                            {t(field.description)}
                          </FieldDescription>
                          <p className="mt-1 text-xs text-muted-foreground">
                            <code>{field.key}</code>
                            <span className="mx-2">·</span>
                            {source}
                          </p>
                          <AutoSaveStatus
                            state={state}
                            onRetry={() => state && autoSave.update(field.key, state.value, 0)}
                          />
                        </FieldContent>
                        <div className="settings-control flex shrink-0 items-start justify-end gap-2">
                          {field.kind === 'boolean' ? (
                            <Switch
                              id={inputId}
                              aria-describedby={descriptionId}
                              aria-invalid={invalid}
                              checked={text === 'true'}
                              disabled={disabled}
                              onCheckedChange={(checked) =>
                                update(field.key, { text: String(checked) })
                              }
                            />
                          ) : field.kind === 'select' ? (
                            <Select
                              value={text}
                              onValueChange={(value) => {
                                if (value !== null) update(field.key, { text: String(value) })
                              }}
                              disabled={disabled}
                            >
                              <SelectTrigger
                                id={inputId}
                                className="w-full"
                                aria-describedby={descriptionId}
                                aria-invalid={invalid}
                              >
                                <SelectValue>{text}</SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                <SelectGroup>
                                  {field.options?.map((option) => (
                                    <SelectItem key={String(option)} value={String(option)}>
                                      {String(option)}
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              </SelectContent>
                            </Select>
                          ) : field.kind === 'json' || field.kind === 'lines' ? (
                            <Textarea
                              id={inputId}
                              aria-describedby={descriptionId}
                              aria-invalid={invalid}
                              value={text}
                              disabled={disabled}
                              onChange={(event) => update(field.key, { text: event.target.value })}
                              onBlur={() => void autoSave.flush()}
                              placeholder={
                                field.placeholder ??
                                (field.kind === 'json' ? '{}' : t('每行一个条目'))
                              }
                              rows={field.kind === 'json' ? 4 : 3}
                              spellCheck={false}
                              className="min-h-20 flex-1"
                            />
                          ) : (
                            <Input
                              id={inputId}
                              aria-describedby={descriptionId}
                              aria-invalid={invalid}
                              type={field.kind === 'number' ? 'number' : 'text'}
                              min={field.min}
                              step={field.kind === 'number' ? 1 : undefined}
                              value={text}
                              disabled={disabled}
                              onChange={(event) => update(field.key, { text: event.target.value })}
                              onBlur={() => void autoSave.flush()}
                              placeholder={field.placeholder ?? t('使用默认值')}
                              spellCheck={false}
                              className="min-w-0 flex-1"
                            />
                          )}
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            disabled={resetDisabled}
                            aria-label={`${t('恢复默认值')} · ${t(field.label)}`}
                            title={t('恢复默认值')}
                            onClick={() => update(field.key, { text: '', reset: true })}
                          >
                            <RotateCcwIcon />
                          </Button>
                        </div>
                      </Field>
                    )
                  })}
              </FieldGroup>
            </section>
          ))}
        {data && fields.length === 0 && !general && (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t('未找到设置')}</EmptyTitle>
              <EmptyDescription>{t('试试设置名称、说明或 配置字段。')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </>
  )
}
