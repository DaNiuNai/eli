import { useEffect, useState, useSyncExternalStore } from 'react'
import { AutoSaveStatus } from '@renderer/components/AutoSaveStatus'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel
} from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { useLanguage } from '@renderer/hooks/use-language'
import { useAutoSave } from '@renderer/hooks/use-auto-save'
import {
  getAppPreferences,
  getAppPreferencesError,
  subscribeAppPreferences,
  updateAppPreferences
} from '@renderer/lib/app-preferences'
import type { TerminalDiscovery } from '../../../shared/terminal'

export function TerminalSettings(): React.JSX.Element {
  const { t } = useLanguage()
  const { terminal } = useSyncExternalStore(subscribeAppPreferences, getAppPreferences)
  const [discovery, setDiscovery] = useState<TerminalDiscovery | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [customPath, setCustomPath] = useState('')
  const [discoveryError, setDiscoveryError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const autoSave = useAutoSave<string>(async (_key, path) => {
    const terminal = await window.terminal.validate(path)
    if (!(await updateAppPreferences({ terminal }))) {
      throw new Error(getAppPreferencesError() ?? '无法保存终端设置')
    }
  })
  const state = autoSave.states.terminal
  const error = state?.status === 'error' ? state.error : discoveryError

  useEffect(() => {
    let active = true
    void window.terminal
      .discover()
      .then((result) => {
        if (!active) return
        setDiscovery(result)
        const preferred = getAppPreferences().terminal ?? result.defaultTerminal
        if (result.options.some((option) => option.path === preferred.path)) {
          setSelected(preferred.path)
        } else {
          setSelected('custom')
          setCustomPath(preferred.path)
        }
      })
      .catch((cause: unknown) => {
        if (!active) return
        setDiscoveryError(cause instanceof Error ? cause.message : String(cause))
        setSelected('custom')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const options = discovery?.options ?? []
  const items = [
    ...options.map((option) => ({ value: option.path, label: option.label })),
    { value: 'custom', label: t('自定义路径') }
  ]
  const path = selected === 'custom' ? customPath : (selected ?? '')

  return (
    <FieldGroup className="gap-0">
      <Field
        orientation="responsive"
        className="settings-row"
        data-disabled={loading}
        data-invalid={!!error}
      >
        <FieldContent className="min-w-0">
          <FieldLabel htmlFor="settings-terminal">{t('命令执行终端')}</FieldLabel>
          <FieldDescription className="break-all">
            {terminal?.path ?? t('使用系统默认终端')}
          </FieldDescription>
          <FieldDescription id="settings-terminal-description">
            {t('仅对 eli 生效，修改后自动保存，后续请求使用新终端。')}
          </FieldDescription>
        </FieldContent>
        <FieldGroup className="settings-control shrink-0 gap-3">
          <Field data-invalid={!!error} data-disabled={loading}>
            <Select
              items={items}
              value={selected}
              onValueChange={(value) => {
                if (!value) return
                setSelected(value)
                setDiscoveryError(null)
                autoSave.update(
                  'terminal',
                  value === 'custom' ? customPath : value,
                  value === 'custom' ? 400 : 0
                )
              }}
              disabled={loading}
            >
              <SelectTrigger
                id="settings-terminal"
                className="w-full"
                aria-describedby="settings-terminal-description"
                aria-invalid={!!error}
              >
                <SelectValue placeholder={t('正在检测终端…')} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {options.map((option) => (
                    <SelectItem key={option.path} value={option.path}>
                      <span className="flex min-w-0 flex-col gap-1">
                        <span>
                          {option.label}
                          {option.path === discovery?.defaultTerminal.path && ` · ${t('系统默认')}`}
                        </span>
                        <span className="break-all text-xs text-muted-foreground">
                          {option.path}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                  <SelectItem value="custom">{t('自定义路径')}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            {selected !== 'custom' && path && (
              <FieldDescription className="break-all">{path}</FieldDescription>
            )}
          </Field>
          {selected === 'custom' && (
            <Field data-invalid={!!error}>
              <FieldLabel htmlFor="settings-terminal-path">{t('可执行文件路径')}</FieldLabel>
              <Input
                id="settings-terminal-path"
                value={customPath}
                onChange={(event) => {
                  setCustomPath(event.target.value)
                  setDiscoveryError(null)
                  autoSave.update('terminal', event.target.value)
                }}
                onBlur={() => void autoSave.flush()}
                aria-invalid={!!error}
                aria-describedby="settings-terminal-path-description"
                autoComplete="off"
                spellCheck={false}
                placeholder={t('输入终端可执行文件的完整路径')}
              />
              <FieldDescription id="settings-terminal-path-description">
                {t('支持 powershell、pwsh、bash、zsh 和 sh，可使用 ~ 表示用户目录。')}
              </FieldDescription>
            </Field>
          )}
          {discoveryError && <FieldError>{t(discoveryError)}</FieldError>}
          <AutoSaveStatus state={state} onRetry={() => autoSave.update('terminal', path, 0)} />
        </FieldGroup>
      </Field>
    </FieldGroup>
  )
}
