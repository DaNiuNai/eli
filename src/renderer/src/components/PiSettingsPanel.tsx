import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { CheckIcon, RotateCcwIcon } from 'lucide-react'
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
import {
  piSettingDefinitions,
  type PiSettingDefinition,
  type PiSettingsCategory,
  type PiSettingsChange,
  type PiSettingsSnapshot
} from '../../../shared/pi-settings'

type Draft = { text: string; reset?: boolean }

function format(value: unknown, field: PiSettingDefinition): string {
  if (value === undefined) return ''
  if (field.kind === 'lines') return Array.isArray(value) ? value.join('\n') : ''
  if (field.kind === 'json') return JSON.stringify(value, null, 2)
  if (value === 'disabled' && field.kind === 'number') return '0'
  return String(value)
}

function parse(text: string, field: PiSettingDefinition): unknown {
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

export function PiSettingsPanel({
  category,
  query,
  general
}: {
  category: PiSettingsCategory | 'general'
  query: string
  general: ReactNode
}): React.JSX.Element {
  const { t } = useLanguage()
  const id = useId()
  const [data, setData] = useState<PiSettingsSnapshot | null>(null)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [reload, setReload] = useState(0)
  const [invalidKey, setInvalidKey] = useState('')
  const scroll = useRef<HTMLDivElement>(null)
  const active = useRef(true)

  useEffect(() => {
    active.current = true
    let current = true
    void window.api
      .getSettings()
      .then((result) => {
        if (current) {
          setData(result)
          setError('')
        }
      })
      .catch((cause: unknown) => {
        if (current) setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      current = false
      active.current = false
    }
  }, [reload])

  useEffect(() => {
    scroll.current?.scrollTo({ top: 0 })
  }, [category, query])

  function update(key: string, draft: Draft): void {
    setDrafts((current) => ({ ...current, [key]: draft }))
    setSaved(false)
    setError('')
    setInvalidKey('')
  }

  async function save(): Promise<void> {
    if (!data || saving) return
    setError('')
    const changes: PiSettingsChange[] = []
    try {
      for (const [key, draft] of Object.entries(drafts)) {
        const field = piSettingDefinitions.find((item) => item.key === key)!
        try {
          const reset =
            draft.reset || (!draft.text.trim() && !['boolean', 'lines'].includes(field.kind))
          changes.push({
            key,
            ...(reset ? { reset: true } : { value: parse(draft.text, field) }),
            expected: data.values[key]
          })
        } catch (cause) {
          setInvalidKey(key)
          throw cause
        }
      }
      setSaving(true)
      const result = await window.api.saveSettings(changes)
      if (!active.current) return
      setData(result)
      setDrafts({})
      setSaved(true)
    } catch (cause) {
      if (active.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (active.current) setSaving(false)
    }
  }

  const search = query.trim().toLowerCase()
  const fields = piSettingDefinitions.filter((field) =>
    search
      ? [
          field.key,
          field.label,
          field.description,
          field.section,
          t(field.label),
          t(field.description)
        ].some((value) => value.toLowerCase().includes(search))
      : field.category === category
  )
  const sections = [...new Set(fields.map((field) => field.section))]
  const changed = Object.keys(drafts).length

  if (category === 'general' && !search)
    return <div className="overflow-y-auto px-8 pb-8">{general}</div>

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
              disabled={saving}
              onClick={() => {
                setDrafts({})
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
                    const draft = drafts[field.key]
                    const inherited = field.defaultValue
                    const raw = data.values[field.key]
                    const value = draft?.reset ? inherited : (raw ?? inherited)
                    const text = draft && !draft.reset ? draft.text : format(value, field)
                    const disabled = saving
                    const invalid = invalidKey === field.key
                    const inputId = `${id}-${field.key}`
                    const descriptionId = `${inputId}-description`
                    const resetDisabled =
                      disabled || (raw === undefined && !draft) || !!draft?.reset
                    const source = draft
                      ? draft.reset
                        ? t('恢复默认值')
                        : t('未保存')
                      : raw !== undefined
                        ? t('已自定义')
                        : t('PI 默认值')
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
              <EmptyDescription>{t('试试设置名称、说明或 PI 配置字段。')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
      <footer className="flex shrink-0 items-center justify-between gap-3 border-t px-8 py-4">
        <p
          className="flex items-center gap-2 text-xs leading-relaxed text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          {saved ? (
            <>
              <CheckIcon className="size-3.5" />
              {t('已保存，后续请求将加载新配置。')}
            </>
          ) : changed ? (
            t('有 {count} 项未保存', { count: changed })
          ) : (
            t('保存后在后续请求生效，当前任务继续运行。')
          )}
        </p>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={!changed || saving}
            onClick={() => {
              setDrafts({})
              setError('')
              setInvalidKey('')
            }}
          >
            {t('放弃更改')}
          </Button>
          <Button size="sm" disabled={!changed || saving || !data} onClick={() => void save()}>
            {saving && <Spinner data-icon="inline-start" />}
            {t(saving ? '正在保存' : '保存更改')}
          </Button>
        </div>
      </footer>
    </>
  )
}
