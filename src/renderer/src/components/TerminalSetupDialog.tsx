import { useEffect, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@renderer/components/ui/alert'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Spinner } from '@renderer/components/ui/spinner'
import { useLanguage } from '@renderer/hooks/use-language'
import {
  getAppPreferences,
  getAppPreferencesError,
  updateAppPreferences
} from '@renderer/lib/app-preferences'
import type { TerminalDiscovery } from '../../../shared/terminal'

export function TerminalSetupDialog({
  onComplete,
  onCancel
}: {
  onComplete: () => void
  onCancel?: () => void
}): React.JSX.Element {
  const { t } = useLanguage()
  const [discovery, setDiscovery] = useState<TerminalDiscovery | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [customPath, setCustomPath] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

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
        setError(cause instanceof Error ? cause.message : String(cause))
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

  async function save(): Promise<void> {
    if (saving || !path.trim()) return
    setSaving(true)
    setError(null)
    try {
      const terminal = await window.terminal.validate(path)
      if (await updateAppPreferences({ terminal })) onComplete()
      else setError(getAppPreferencesError() ?? '无法保存终端设置')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onCancel?.()
      }}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t(onCancel ? '更改终端' : '选择终端')}</DialogTitle>
          <DialogDescription>
            {t('选择 pi 在 eli 中执行命令时使用的终端，仅对 eli 生效。')}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertTitle>{t('终端设置失败')}</AlertTitle>
            <AlertDescription className="whitespace-pre-wrap break-words">
              {t(error)}
            </AlertDescription>
          </Alert>
        )}
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="setup-terminal">{t('终端')}</FieldLabel>
            <Select
              items={items}
              value={selected}
              onValueChange={setSelected}
              disabled={loading || saving}
            >
              <SelectTrigger id="setup-terminal" className="w-full">
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
            <Field>
              <FieldLabel htmlFor="setup-terminal-path">{t('可执行文件路径')}</FieldLabel>
              <Input
                id="setup-terminal-path"
                value={customPath}
                onChange={(event) => setCustomPath(event.target.value)}
                disabled={saving}
                autoComplete="off"
                spellCheck={false}
                placeholder={t('输入终端可执行文件的完整路径')}
              />
              <FieldDescription>
                {t('支持 powershell、pwsh、bash、zsh 和 sh，可使用 ~ 表示用户目录。')}
              </FieldDescription>
            </Field>
          )}
          <FieldDescription>
            {t('此选择会覆盖 pi 的终端设置，不会修改 pi 的配置文件。')}
          </FieldDescription>
        </FieldGroup>
        <DialogFooter>
          {onCancel && (
            <Button variant="ghost" disabled={saving} onClick={onCancel}>
              {t('取消')}
            </Button>
          )}
          <Button disabled={loading || saving || !path.trim()} onClick={() => void save()}>
            {(loading || saving) && <Spinner data-icon="inline-start" />}
            {t(onCancel ? '保存终端' : '完成设置')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
