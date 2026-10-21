import { useState } from 'react'
import { ExternalLinkIcon, LogInIcon, XIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@renderer/components/ui/alert'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Spinner } from '@renderer/components/ui/spinner'
import { useLanguage } from '@renderer/hooks/use-language'
import type { PiAuthSnapshot, PiLoginPrompt } from '../../../shared/pi-auth'

function LoginPrompt({
  prompt,
  perform
}: {
  prompt: PiLoginPrompt
  perform: (action: () => Promise<unknown>) => Promise<boolean>
}): React.JSX.Element {
  const { t } = useLanguage()
  const [value, setValue] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const items =
    prompt.type === 'select'
      ? prompt.options.map((option) => ({ value: option.id, label: option.label }))
      : []

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault()
        if (submitting) return
        setSubmitting(true)
        const success = await perform(() => window.piAuth.respond(prompt.id, value))
        if (success) setValue('')
        setSubmitting(false)
      }}
    >
      <FieldGroup className="gap-3">
        <Field>
          <FieldLabel htmlFor={`login-${prompt.id}`}>{t(prompt.message)}</FieldLabel>
          {prompt.type === 'select' ? (
            <Select
              items={items}
              value={value || null}
              onValueChange={(next) => setValue(next ?? '')}
              disabled={submitting}
            >
              <SelectTrigger id={`login-${prompt.id}`} className="w-full">
                <SelectValue placeholder={t('请选择')} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {prompt.options.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {t(option.label)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          ) : (
            <Input
              id={`login-${prompt.id}`}
              type={prompt.type === 'secret' ? 'password' : 'text'}
              autoComplete="off"
              spellCheck={false}
              autoFocus
              value={value}
              placeholder={prompt.placeholder ? t(prompt.placeholder) : undefined}
              disabled={submitting}
              onChange={(event) => setValue(event.target.value)}
            />
          )}
        </Field>
        <Button type="submit" disabled={submitting || (prompt.type === 'select' && !value)}>
          {submitting && <Spinner data-icon="inline-start" />}
          {t('继续')}
        </Button>
      </FieldGroup>
    </form>
  )
}

export function PiLoginDialog({
  snapshot,
  open,
  loading,
  error,
  onOpenChange,
  perform
}: {
  snapshot: PiAuthSnapshot | null
  open: boolean
  loading: boolean
  error: string | null
  onOpenChange: (open: boolean) => void
  perform: (action: () => Promise<unknown>) => Promise<boolean>
}): React.JSX.Element {
  const { t } = useLanguage()
  const [selected, setSelected] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const providers = snapshot?.providers ?? []
  const items = providers.map((provider) => ({
    value: JSON.stringify([provider.id, provider.type]),
    label: `${provider.name} · ${t(provider.type === 'oauth' ? '账号登录' : 'API 密钥')}`
  }))
  const provider = providers.find((entry) => JSON.stringify([entry.id, entry.type]) === selected)
  const loggingIn = snapshot?.status === 'logging-in'
  const notice = snapshot?.notice
  const links =
    notice?.type === 'auth_url'
      ? [{ url: notice.url, label: t('打开登录页面') }]
      : notice?.type === 'device_code'
        ? [{ url: notice.verificationUri, label: t('打开登录页面') }]
        : notice?.type === 'info'
          ? (notice.links ?? [])
          : []
  const problem = error || snapshot?.error

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100dvh-4rem)] overflow-y-auto sm:max-w-md"
      >
        <DialogHeader className="pr-6">
          <DialogTitle>{t('登录')}</DialogTitle>
          <DialogDescription>
            {t('使用 pi 支持的账号或 API 密钥登录，与 pi 命令行共用凭据。')}
          </DialogDescription>
        </DialogHeader>

        {problem && (
          <Alert variant="destructive">
            <AlertTitle>{t('登录失败')}</AlertTitle>
            <AlertDescription className="max-h-32 overflow-auto whitespace-pre-wrap break-words">
              {t(problem)}
            </AlertDescription>
          </Alert>
        )}

        {loggingIn ? (
          <div className="flex min-w-0 flex-col gap-4">
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner />
              {t('正在登录 {provider}…', {
                provider: providers.find((entry) => entry.id === snapshot.providerId)?.name ?? ''
              })}
            </p>
            {notice && (
              <Alert>
                <AlertTitle>{t('完成授权')}</AlertTitle>
                <AlertDescription className="flex flex-col gap-3">
                  {notice.type === 'device_code' ? (
                    <>
                      <p>{t('在登录页面输入以下设备码：')}</p>
                      <code className="select-all text-lg font-semibold tracking-widest text-foreground">
                        {notice.userCode}
                      </code>
                    </>
                  ) : (
                    <p className="whitespace-pre-wrap break-words">
                      {t(
                        notice.type === 'auth_url'
                          ? (notice.instructions ?? '在浏览器中完成授权后返回此处。')
                          : notice.message
                      )}
                    </p>
                  )}
                  {links.map((link) => (
                    <Button
                      key={link.url}
                      variant="outline"
                      className="self-start"
                      onClick={() => void perform(() => window.piAuth.openLink(link.url))}
                    >
                      <ExternalLinkIcon data-icon="inline-start" />
                      {link.label || t('打开登录页面')}
                    </Button>
                  ))}
                </AlertDescription>
              </Alert>
            )}
            {snapshot.prompt && (
              <LoginPrompt key={snapshot.prompt.id} prompt={snapshot.prompt} perform={perform} />
            )}
          </div>
        ) : (
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="login-provider">{t('登录服务')}</FieldLabel>
              <Select
                items={items}
                value={selected}
                onValueChange={setSelected}
                disabled={loading || submitting}
              >
                <SelectTrigger id="login-provider" className="w-full">
                  <SelectValue placeholder={t(loading ? '正在加载登录服务…' : '选择登录服务')} />
                </SelectTrigger>
                <SelectContent>
                  {(['oauth', 'api_key'] as const).map((type) => (
                    <SelectGroup key={type}>
                      <SelectLabel>{t(type === 'oauth' ? '账号登录' : 'API 密钥')}</SelectLabel>
                      {providers
                        .filter((entry) => entry.type === type)
                        .map((entry) => (
                          <SelectItem key={entry.id} value={JSON.stringify([entry.id, entry.type])}>
                            {entry.name}
                            {entry.configured && (
                              <span className="text-muted-foreground">{t('已配置')}</span>
                            )}
                          </SelectItem>
                        ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('稍后登录')}
          </Button>
          {loggingIn ? (
            <Button variant="outline" onClick={() => void perform(() => window.piAuth.cancel())}>
              {t('取消登录')}
            </Button>
          ) : (
            <Button
              disabled={!provider || loading || submitting}
              onClick={async () => {
                if (!provider || submitting) return
                setSubmitting(true)
                await perform(() => window.piAuth.login(provider.id, provider.type))
                setSubmitting(false)
              }}
            >
              {submitting ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <LogInIcon data-icon="inline-start" />
              )}
              {t(snapshot?.status === 'error' ? '重新登录' : '登录')}
            </Button>
          )}
        </DialogFooter>
        <DialogClose
          render={<Button variant="ghost" size="icon-sm" className="absolute right-2 top-2" />}
          aria-label={t('关闭')}
        >
          <XIcon />
        </DialogClose>
      </DialogContent>
    </Dialog>
  )
}
