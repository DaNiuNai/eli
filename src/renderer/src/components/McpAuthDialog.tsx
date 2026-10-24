import { useId, useRef, useState } from 'react'
import { ExternalLinkIcon } from 'lucide-react'
import { Alert, AlertDescription } from '@renderer/components/ui/alert'
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
import { Spinner } from '@renderer/components/ui/spinner'
import { useLanguage } from '@renderer/hooks/use-language'
import type { ManagedMcpServer, McpAuthSnapshot, McpConnectionTest } from '../../../shared/mcp'

export function McpAuthDialog({
  server,
  result,
  snapshot,
  reauthorize = false,
  onClose,
  onSaveToken
}: {
  server: ManagedMcpServer
  result?: McpConnectionTest
  snapshot: McpAuthSnapshot | null
  reauthorize?: boolean
  onClose: () => void
  onSaveToken: (server: ManagedMcpServer, token: string) => Promise<void>
}): React.JSX.Element {
  const { t } = useLanguage()
  const id = useId()
  const [token, setToken] = useState('')
  const [redirectUrl, setRedirectUrl] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const operating = useRef(false)
  const [initialAuthId] = useState(snapshot?.id)
  const [tokenSaved, setTokenSaved] = useState(false)
  const auth = snapshot?.serverName === server.name ? snapshot : null
  const authorizing = auth?.status === 'authorizing'
  const completed = tokenSaved || (auth?.status === 'success' && auth.id !== initialAuthId)
  const connected = result?.status === 'connected' && (!reauthorize || completed)
  const method =
    server.authentication.method === 'manual'
      ? 'manual'
      : (result?.authentication?.method ??
        (server.authentication.method === 'oauth' ? 'oauth' : 'unknown'))

  const perform = async (action: () => Promise<void>): Promise<void> => {
    if (operating.current) return
    operating.current = true
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      operating.current = false
      setBusy(false)
    }
  }
  const close = (): void => {
    if (busy) return
    void perform(async () => {
      if (authorizing && auth.id) await window.mcpAuth.cancel(auth.id)
      onClose()
    })
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('MCP 认证')}</DialogTitle>
          <DialogDescription>{server.name}</DialogDescription>
        </DialogHeader>
        {authorizing ? (
          <div className="flex flex-col gap-4">
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner />
              {t('请在浏览器中完成授权，完成后将自动连接。')}
            </p>
            {auth.authorizationUrl && (
              <>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void perform(() => window.mcpAuth.openLink(auth.id!))}
                >
                  <ExternalLinkIcon data-icon="inline-start" />
                  {t('打开授权页面')}
                </Button>
                <details className="text-sm">
                  <summary className="cursor-pointer">{t('浏览器未自动返回？')}</summary>
                  <form
                    className="mt-4"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void perform(async () => {
                        await window.mcpAuth.respond(auth.id!, redirectUrl)
                        setRedirectUrl('')
                      })
                    }}
                  >
                    <FieldGroup className="gap-3">
                      <Field>
                        <FieldLabel htmlFor={`${id}-redirect`}>
                          {t('浏览器中的完整回调地址')}
                        </FieldLabel>
                        <Input
                          id={`${id}-redirect`}
                          type="password"
                          autoComplete="off"
                          spellCheck={false}
                          value={redirectUrl}
                          onChange={(event) => setRedirectUrl(event.target.value)}
                          disabled={busy}
                        />
                        <FieldDescription>
                          {t('仅在授权页面无法返回 eli 时，复制浏览器地址栏中的完整回调地址。')}
                        </FieldDescription>
                      </Field>
                      <Button type="submit" disabled={busy || !redirectUrl.trim()}>
                        {t('继续')}
                      </Button>
                    </FieldGroup>
                  </form>
                </details>
              </>
            )}
          </div>
        ) : connected ? (
          <Alert>
            <AlertDescription>{t('认证已完成，连接成功，凭据已保存在 eli。')}</AlertDescription>
          </Alert>
        ) : (
          <div className="flex flex-col gap-5">
            {method !== 'manual' && (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">
                  {t(
                    method === 'oauth'
                      ? '此服务支持浏览器授权。点击后前往服务商页面登录并授予访问权限。'
                      : '可尝试浏览器授权；如果服务商只提供 API Key，请按下方步骤手动填写令牌。'
                  )}
                </p>
                <Button
                  disabled={busy}
                  onClick={() => void perform(() => window.mcpAuth.start(server.name, reauthorize))}
                >
                  <ExternalLinkIcon data-icon="inline-start" />
                  {t(reauthorize ? '重新授权' : '浏览器授权')}
                </Button>
              </div>
            )}
            <details open={method === 'manual' || auth?.status === 'error'} className="text-sm">
              <summary className="cursor-pointer font-medium">
                {t('手动获取并填写访问令牌')}
              </summary>
              <div className="mt-4 flex flex-col gap-4">
                <ol className="flex list-decimal flex-col gap-2 pl-5 text-muted-foreground">
                  <li>{t('前往服务商官网或控制台，找到 API Keys 或 Access Tokens。')}</li>
                  <li>{t('创建允许访问此 MCP 服务的令牌，并复制令牌值。')}</li>
                  <li>
                    {t('在下方粘贴令牌，eli 会保存为 Authorization: Bearer 请求头并测试连接。')}
                  </li>
                </ol>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void perform(() => window.mcpAuth.openWebsite(server.name))}
                >
                  <ExternalLinkIcon data-icon="inline-start" />
                  {t('打开服务网站或认证文档')}
                </Button>
                <p className="text-xs text-muted-foreground">
                  {t('若打开的是 API 域名，请从服务商官网进入控制台；具体入口以服务商文档为准。')}
                </p>
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    void perform(async () => {
                      await onSaveToken(server, token)
                      setTokenSaved(true)
                      setToken('')
                    })
                  }}
                >
                  <FieldGroup className="gap-3">
                    <Field>
                      <FieldLabel htmlFor={`${id}-token`}>{t('访问令牌')}</FieldLabel>
                      <Input
                        id={`${id}-token`}
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        value={token}
                        onChange={(event) => setToken(event.target.value)}
                        disabled={busy}
                      />
                      <FieldDescription>
                        {t(
                          '粘贴令牌即可，无需手动添加 Bearer。其他认证格式可在编辑服务的请求头中配置。'
                        )}
                      </FieldDescription>
                    </Field>
                    <Button type="submit" disabled={busy || !token.trim()}>
                      {busy && <Spinner data-icon="inline-start" />}
                      {t('保存令牌并测试')}
                    </Button>
                  </FieldGroup>
                </form>
              </div>
            </details>
          </div>
        )}
        {(error || auth?.error) && (
          <Alert variant="destructive">
            <AlertDescription>{t(error || auth?.error || '')}</AlertDescription>
          </Alert>
        )}
        {result && result.status !== 'connected' && !authorizing && !connected && (
          <p role="status" className="text-sm text-muted-foreground">
            {t(result.message)}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={close}>
            {t(authorizing ? '取消授权' : '关闭')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
