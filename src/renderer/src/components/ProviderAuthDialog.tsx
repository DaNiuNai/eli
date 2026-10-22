import { useState } from 'react'
import { ExternalLinkIcon } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
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
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Spinner } from '@renderer/components/ui/spinner'
import { useLanguage } from '@renderer/hooks/use-language'
import type { AgentAuthSnapshot, AgentLoginPrompt } from '../../../shared/agent-auth'

function LoginPrompt({
  prompt,
  perform
}: {
  prompt: AgentLoginPrompt
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
        const success = await perform(() => window.agentAuth.respond(prompt.id, value))
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

export function ProviderAuthDialog({
  snapshot,
  perform
}: {
  snapshot: AgentAuthSnapshot | null
  perform: (action: () => Promise<unknown>) => Promise<boolean>
}): React.JSX.Element {
  const { t } = useLanguage()
  const notice = snapshot?.notice
  const links =
    notice?.type === 'auth_url'
      ? [{ url: notice.url, label: t('打开登录页面') }]
      : notice?.type === 'device_code'
        ? [{ url: notice.verificationUri, label: t('打开登录页面') }]
        : notice?.type === 'info'
          ? (notice.links ?? [])
          : []
  return (
    <Dialog
      open={snapshot?.status === 'logging-in'}
      onOpenChange={(open) => {
        if (!open) void perform(() => window.agentAuth.cancel())
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('完成供应商授权')}</DialogTitle>
          <DialogDescription>{t('按供应商提示完成授权，凭据将保存在 eli。')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner />
            {t('正在等待授权…')}
          </p>
          {notice?.type === 'device_code' ? (
            <>
              <p>{t('在登录页面输入以下设备码：')}</p>
              <code className="select-all text-lg font-semibold">{notice.userCode}</code>
            </>
          ) : (
            notice && (
              <p className="whitespace-pre-wrap break-words text-sm">
                {notice.type === 'auth_url' ? notice.instructions : notice.message}
              </p>
            )
          )}
          {links.map((link) => (
            <Button
              key={link.url}
              variant="outline"
              className="self-start"
              onClick={() => void perform(() => window.agentAuth.openLink(link.url))}
            >
              <ExternalLinkIcon data-icon="inline-start" />
              {link.label || t('打开登录页面')}
            </Button>
          ))}
          {snapshot?.prompt && (
            <LoginPrompt key={snapshot.prompt.id} prompt={snapshot.prompt} perform={perform} />
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => void perform(() => window.agentAuth.cancel())}>
            {t('取消登录')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
