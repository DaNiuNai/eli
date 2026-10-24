import { useCallback, useEffect, useId, useRef, useState } from 'react'
import {
  LogOutIcon,
  PencilIcon,
  PlugIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  WrenchIcon
} from 'lucide-react'
import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@renderer/components/ui/alert-dialog'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@renderer/components/ui/empty'
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
import { Skeleton } from '@renderer/components/ui/skeleton'
import { Spinner } from '@renderer/components/ui/spinner'
import { Switch } from '@renderer/components/ui/switch'
import { Textarea } from '@renderer/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group'
import { useLanguage } from '@renderer/hooks/use-language'
import { McpAuthDialog } from './McpAuthDialog'
import type {
  ManagedMcpServer,
  McpAuthenticationStatus,
  McpAuthSnapshot,
  McpConnectionTest,
  McpServerChange,
  McpServerConfig
} from '../../../shared/mcp'

const exposures = [
  { value: 'codemode', label: '通过代码调用' },
  { value: 'deferred', label: '搜索后调用' },
  { value: 'direct', label: '直接提供给模型' },
  { value: 'hidden', label: '隐藏工具' }
] as const

const authStateLabels: Record<McpAuthenticationStatus['state'], string> = {
  authenticated: '已认证',
  configured: '已配置认证，待验证',
  unauthenticated: '未认证',
  expired: '认证已过期',
  'needs-auth': '需要重新认证',
  authorizing: '认证中',
  'not-required': '无需认证',
  external: '由服务管理认证'
}

function McpEditor({
  server,
  onClose,
  onSave
}: {
  server: ManagedMcpServer | null
  onClose: () => void
  onSave: (change: McpServerChange) => Promise<void>
}): React.JSX.Element {
  const { t } = useLanguage()
  const id = useId()
  const config = server?.config
  const stdio = config && 'command' in config ? config : undefined
  const http = config && 'url' in config ? config : undefined
  const [name, setName] = useState(server?.name ?? '')
  const [transport, setTransport] = useState<'stdio' | 'http'>(http ? 'http' : 'stdio')
  const [command, setCommand] = useState(stdio?.command ?? '')
  const [args, setArgs] = useState(JSON.stringify(stdio?.args ?? [], null, 2))
  const [cwd, setCwd] = useState(stdio?.cwd ?? '')
  const [env, setEnv] = useState(JSON.stringify(stdio?.env ?? {}, null, 2))
  const [url, setUrl] = useState(http?.url ?? '')
  const [headers, setHeaders] = useState(JSON.stringify(http?.headers ?? {}, null, 2))
  const [description, setDescription] = useState(config?.description ?? '')
  const [timeout, setTimeoutValue] = useState(String(config?.timeout ?? 60))
  const [exposure, setExposure] = useState(config?.exposure ?? 'codemode')
  const [error, setError] = useState('')
  const [invalid, setInvalid] = useState('')
  const [saving, setSaving] = useState(false)
  const submitting = useRef(false)

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (submitting.current) return
    submitting.current = true
    setSaving(true)
    setError('')
    setInvalid('')
    let field = 'name'
    try {
      if (!/^[a-zA-Z0-9_-]+$/.test(name.trim()))
        throw new Error(t('名称只能包含字母、数字、下划线和短横线。'))
      field = 'timeout'
      if (!Number.isFinite(Number(timeout)) || Number(timeout) <= 0)
        throw new Error(t('超时必须是大于 0 的秒数。'))
      const base = {
        enabled: config?.enabled ?? true,
        description: description.trim(),
        exposure,
        timeout: Number(timeout),
        ...(config?.toolExposure ? { toolExposure: config.toolExposure } : {})
      }
      let next: McpServerConfig
      if (transport === 'stdio') {
        field = 'command'
        if (!command.trim()) throw new Error(t('请填写启动命令。'))
        field = 'args'
        let parsedArgs: unknown
        try {
          parsedArgs = JSON.parse(args)
        } catch {
          throw new Error(t('参数必须是 JSON 字符串数组。'))
        }
        if (!Array.isArray(parsedArgs) || !parsedArgs.every((arg) => typeof arg === 'string'))
          throw new Error(t('参数必须是 JSON 字符串数组。'))
        field = 'env'
        next = {
          ...base,
          type: 'stdio',
          command: command.trim(),
          args: parsedArgs,
          cwd: cwd.trim() || undefined,
          env: stringMap(env)
        }
      } else {
        field = 'url'
        if (
          !URL.canParse(url.trim()) ||
          !['http:', 'https:'].includes(new URL(url.trim()).protocol)
        )
          throw new Error(t('请填写有效的 HTTP 或 HTTPS 地址。'))
        field = 'headers'
        next = { ...http, ...base, type: 'http', url: url.trim(), headers: stringMap(headers) }
      }
      field = ''
      await onSave(
        server
          ? { action: 'update', name: server.name, config: next, expected: server.config }
          : { action: 'create', name: name.trim(), config: next }
      )
      onClose()
    } catch (cause) {
      setInvalid(field)
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      submitting.current = false
      setSaving(false)
    }
  }

  function stringMap(text: string): Record<string, string> {
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      throw new Error(t('请填写值均为字符串的 JSON 对象。'))
    }
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !Object.values(value).every((entry) => typeof entry === 'string')
    )
      throw new Error(t('请填写值均为字符串的 JSON 对象。'))
    return value as Record<string, string>
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose()
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t(server ? '编辑 MCP 服务' : '添加 MCP 服务')}</DialogTitle>
          <DialogDescription>{t('配置本地命令或远程 Streamable HTTP 服务。')}</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-5" onSubmit={(event) => void submit(event)}>
          <fieldset disabled={saving} className="min-w-0">
            <FieldGroup>
              <Field data-invalid={invalid === 'name'}>
                <FieldLabel htmlFor={`${id}-name`}>{t('服务名称')}</FieldLabel>
                <Input
                  id={`${id}-name`}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  readOnly={!!server}
                  aria-invalid={invalid === 'name'}
                  autoComplete="off"
                  placeholder="my-server"
                />
                <FieldDescription>{t('名称用于区分服务，保存后不可修改。')}</FieldDescription>
              </Field>
              <Field>
                <FieldLabel id={`${id}-transport`}>{t('传输方式')}</FieldLabel>
                <ToggleGroup
                  variant="outline"
                  value={[transport]}
                  onValueChange={(values) => {
                    if (values[0] === 'stdio' || values[0] === 'http') setTransport(values[0])
                  }}
                  aria-labelledby={`${id}-transport`}
                >
                  <ToggleGroupItem value="stdio">{t('本地 stdio')}</ToggleGroupItem>
                  <ToggleGroupItem value="http">{t('远程 HTTP')}</ToggleGroupItem>
                </ToggleGroup>
              </Field>
              {transport === 'stdio' ? (
                <>
                  <Field data-invalid={invalid === 'command'}>
                    <FieldLabel htmlFor={`${id}-command`}>{t('启动命令')}</FieldLabel>
                    <Input
                      id={`${id}-command`}
                      value={command}
                      onChange={(event) => setCommand(event.target.value)}
                      placeholder="npx"
                      aria-invalid={invalid === 'command'}
                    />
                  </Field>
                  <Field data-invalid={invalid === 'args'}>
                    <FieldLabel htmlFor={`${id}-args`}>{t('参数（JSON 数组）')}</FieldLabel>
                    <Textarea
                      id={`${id}-args`}
                      value={args}
                      onChange={(event) => setArgs(event.target.value)}
                      rows={3}
                      spellCheck={false}
                      placeholder={'["-y", "@example/mcp-server"]'}
                      aria-invalid={invalid === 'args'}
                    />
                    <FieldDescription>
                      {t('每个参数单独填写为数组元素，包含空格的路径也只占一个元素。')}
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`${id}-cwd`}>{t('工作目录（可选）')}</FieldLabel>
                    <Input
                      id={`${id}-cwd`}
                      value={cwd}
                      onChange={(event) => setCwd(event.target.value)}
                    />
                    <FieldDescription>
                      {t('留空使用当前会话的工作目录；连接测试使用当前打开的工作目录。')}
                    </FieldDescription>
                  </Field>
                  <Field data-invalid={invalid === 'env'}>
                    <FieldLabel htmlFor={`${id}-env`}>{t('环境变量（JSON 对象）')}</FieldLabel>
                    <Textarea
                      id={`${id}-env`}
                      value={env}
                      onChange={(event) => setEnv(event.target.value)}
                      rows={3}
                      spellCheck={false}
                      aria-invalid={invalid === 'env'}
                    />
                  </Field>
                </>
              ) : (
                <>
                  <Field data-invalid={invalid === 'url'}>
                    <FieldLabel htmlFor={`${id}-url`}>{t('服务地址')}</FieldLabel>
                    <Input
                      id={`${id}-url`}
                      value={url}
                      onChange={(event) => setUrl(event.target.value)}
                      placeholder="https://example.com/mcp"
                      aria-invalid={invalid === 'url'}
                    />
                  </Field>
                  <Field data-invalid={invalid === 'headers'}>
                    <FieldLabel htmlFor={`${id}-headers`}>{t('请求头（JSON 对象）')}</FieldLabel>
                    <Textarea
                      id={`${id}-headers`}
                      value={headers}
                      onChange={(event) => setHeaders(event.target.value)}
                      rows={3}
                      spellCheck={false}
                      placeholder={'{"Authorization": "Bearer …"}'}
                      aria-invalid={invalid === 'headers'}
                    />
                    <FieldDescription>
                      {t('需要令牌认证时，在此填写 Authorization 请求头。')}
                    </FieldDescription>
                  </Field>
                </>
              )}
              <Field>
                <FieldLabel htmlFor={`${id}-description`}>{t('描述（可选）')}</FieldLabel>
                <Input
                  id={`${id}-description`}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-exposure`}>{t('工具提供方式')}</FieldLabel>
                <Select
                  value={exposure}
                  onValueChange={(value) => {
                    if (exposures.some((option) => option.value === value))
                      setExposure(value as typeof exposure)
                  }}
                >
                  <SelectTrigger id={`${id}-exposure`} className="w-full">
                    <SelectValue>
                      {t(exposures.find((option) => option.value === exposure)?.label ?? '')}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {exposures.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {t(option.label)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field data-invalid={invalid === 'timeout'}>
                <FieldLabel htmlFor={`${id}-timeout`}>{t('请求超时（秒）')}</FieldLabel>
                <Input
                  id={`${id}-timeout`}
                  type="number"
                  min="0.1"
                  step="any"
                  value={timeout}
                  onChange={(event) => setTimeoutValue(event.target.value)}
                  aria-invalid={invalid === 'timeout'}
                />
              </Field>
            </FieldGroup>
          </fieldset>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{t(error)}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              {t('取消')}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Spinner data-icon="inline-start" />}
              {t(saving ? '正在保存…' : '保存')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function McpSettingsPanel(): React.JSX.Element {
  const { t } = useLanguage()
  const [servers, setServers] = useState<ManagedMcpServer[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [editor, setEditor] = useState<{ server: ManagedMcpServer | null } | null>(null)
  const [deleting, setDeleting] = useState<ManagedMcpServer | null>(null)
  const [tools, setTools] = useState<{ name: string; result: McpConnectionTest } | null>(null)
  const [results, setResults] = useState<Record<string, McpConnectionTest>>({})
  const [auth, setAuth] = useState<McpAuthSnapshot | null>(null)
  const [authServer, setAuthServer] = useState<ManagedMcpServer | null>(null)
  const [reauthorizing, setReauthorizing] = useState(false)
  const [signingOut, setSigningOut] = useState<ManagedMcpServer | null>(null)
  const authRevision = useRef(-1)
  const active = useRef(true)
  const operating = useRef(false)
  const loadRevision = useRef(0)
  const refreshServers = useCallback(async (): Promise<void> => {
    const revision = ++loadRevision.current
    const next = await window.api.getMcpServers()
    if (active.current && revision === loadRevision.current) setServers(next)
  }, [])

  useEffect(() => {
    active.current = true
    const receive = (snapshot: McpAuthSnapshot): void => {
      if (!active.current || snapshot.revision <= authRevision.current) return
      authRevision.current = snapshot.revision
      setAuth((previous) =>
        !previous || snapshot.revision > previous.revision ? snapshot : previous
      )
      if (snapshot.status === 'success' && snapshot.serverName && snapshot.result)
        setResults((previous) => ({ ...previous, [snapshot.serverName!]: snapshot.result! }))
      if (snapshot.status === 'signed-out')
        setResults((previous) =>
          Object.fromEntries(
            Object.entries(previous).filter(([name]) => name !== snapshot.serverName)
          )
        )
      void refreshServers().catch((cause: unknown) => {
        if (active.current) setError(cause instanceof Error ? cause.message : String(cause))
      })
    }
    const unsubscribe = window.mcpAuth.onSnapshot(receive)
    void window.mcpAuth.get().then(receive, (cause: unknown) => {
      if (active.current) setError(cause instanceof Error ? cause.message : String(cause))
    })
    void refreshServers().catch((cause: unknown) => {
      if (active.current) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => {
      active.current = false
      unsubscribe()
    }
  }, [refreshServers])

  const perform = async (key: string, operation: () => Promise<void>): Promise<void> => {
    if (operating.current) return
    operating.current = true
    setBusy(key)
    setError('')
    try {
      await operation()
    } catch (cause) {
      if (active.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      operating.current = false
      if (active.current) setBusy('')
    }
  }

  const change = async (value: McpServerChange): Promise<void> => {
    const next = await window.api.changeMcpServer(value)
    if (active.current) {
      setServers(next)
      setResults((previous) =>
        Object.fromEntries(Object.entries(previous).filter(([name]) => name !== value.name))
      )
    }
  }

  const saveToken = async (server: ManagedMcpServer, input: string): Promise<void> => {
    if (!('url' in server.config)) throw new Error(t('请选择远程 HTTP MCP 服务'))
    const token = input.trim().replace(/^Bearer\s+/i, '')
    if (!token || token.length > 32768 || /[\r\n]/.test(token))
      throw new Error(t('请填写有效的访问令牌。'))
    const headers = Object.fromEntries(
      Object.entries(server.config.headers ?? {}).filter(
        ([key]) => key.toLowerCase() !== 'authorization'
      )
    )
    const config = { ...server.config, headers: { ...headers, Authorization: `Bearer ${token}` } }
    const next = await window.api.changeMcpServer({
      action: 'update',
      name: server.name,
      config,
      expected: server.config
    })
    if (active.current) {
      setServers(next)
      setAuthServer(next.find((entry) => entry.name === server.name) ?? null)
    }
    const result = await window.api.testMcpServer(server.name)
    if (active.current) setResults((previous) => ({ ...previous, [server.name]: result }))
    await refreshServers()
  }
  const selectedAuthServer =
    authServer ??
    (auth?.status === 'authorizing'
      ? servers?.find((server) => server.name === auth.serverName)
      : null)

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{t('MCP 服务')}</h3>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={!!busy}
            onClick={() =>
              void perform('reload', async () => {
                const next = await window.api.getMcpServers()
                if (active.current) {
                  setServers(next)
                  setResults({})
                }
              })
            }
          >
            <RefreshCwIcon data-icon="inline-start" />
            {t('重新加载')}
          </Button>
          <Button
            size="sm"
            disabled={!!busy || !servers}
            onClick={() => setEditor({ server: null })}
          >
            <PlusIcon data-icon="inline-start" />
            {t('添加服务')}
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        {t('管理 eli 中添加的用户级 MCP 服务，供所有工作目录的聊天调用。')}
      </p>
      <p className="text-sm text-muted-foreground">
        {t('保存与开关修改在下一次会话操作时生效。连接测试只获取工具列表，测试后自动断开。')}
      </p>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{t(error)}</AlertDescription>
        </Alert>
      )}
      {!servers && !error ? (
        <div role="status" aria-label={t('正在加载 MCP…')} className="flex flex-col gap-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : servers?.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PlugIcon />
            </EmptyMedia>
            <EmptyTitle>{t('暂无 MCP 服务')}</EmptyTitle>
            <EmptyDescription>
              {t('添加本地 stdio 或远程 HTTP 服务，为 eli 扩展工具。')}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-4">
          {servers?.map((server) => {
            const result = results[server.name]
            const authentication = server.authentication
            const authState =
              auth?.status === 'authorizing' && auth.serverName === server.name
                ? 'authorizing'
                : authentication.state
            return (
              <section
                key={server.name}
                className="flex min-w-0 flex-col gap-3 rounded-lg border p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="break-all text-sm font-medium">{server.name}</span>
                      <Badge variant="outline">{'url' in server.config ? 'HTTP' : 'stdio'}</Badge>
                      <Badge variant="secondary">
                        {t(server.config.enabled === false ? '已停用' : '已启用')}
                      </Badge>
                      <Badge
                        variant={
                          authState === 'expired' || authState === 'needs-auth'
                            ? 'destructive'
                            : 'outline'
                        }
                      >
                        {t(
                          authentication.method === 'local'
                            ? '本地服务管理认证'
                            : authentication.method === 'provider' && authState === 'external'
                              ? '由供应商管理认证'
                              : authStateLabels[authState]
                        )}
                      </Badge>
                    </div>
                    {server.config.description && (
                      <p className="break-words text-sm text-muted-foreground">
                        {server.config.description}
                      </p>
                    )}
                    <p className="break-all text-xs text-muted-foreground">
                      {'url' in server.config ? server.config.url : server.config.command}
                    </p>
                  </div>
                  <Switch
                    checked={server.config.enabled !== false}
                    disabled={!!busy}
                    aria-label={t('启用 MCP 服务 {name}', { name: server.name })}
                    onCheckedChange={(enabled) =>
                      void perform(server.name, () =>
                        change({ action: 'setEnabled', name: server.name, enabled })
                      )
                    }
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!!busy}
                    onClick={() =>
                      void perform(`test:${server.name}`, async () => {
                        const result = await window.api.testMcpServer(server.name)
                        if (active.current)
                          setResults((previous) => ({ ...previous, [server.name]: result }))
                        await refreshServers()
                      })
                    }
                  >
                    {busy === `test:${server.name}` ? (
                      <Spinner data-icon="inline-start" />
                    ) : (
                      <PlugIcon data-icon="inline-start" />
                    )}
                    {t(busy === `test:${server.name}` ? '正在测试…' : '测试连接')}
                  </Button>
                  {result?.status === 'connected' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setTools({ name: server.name, result })}
                    >
                      <WrenchIcon data-icon="inline-start" />
                      {t('{count} 个工具', { count: result.tools.length })}
                    </Button>
                  )}
                  {'url' in server.config &&
                    authentication.canReauthorize &&
                    authState !== 'not-required' && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!!busy}
                        onClick={() => {
                          setReauthorizing(authentication.canSignOut || authState === 'expired')
                          setAuthServer(server)
                        }}
                      >
                        {t(
                          authentication.canSignOut || authState === 'expired'
                            ? '重新授权'
                            : '获取认证'
                        )}
                      </Button>
                    )}
                  {authentication.canSignOut && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!!busy}
                      onClick={() => setSigningOut(server)}
                    >
                      <LogOutIcon data-icon="inline-start" />
                      {t('退出认证')}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!!busy}
                    onClick={() => setEditor({ server })}
                  >
                    <PencilIcon data-icon="inline-start" />
                    {t('编辑')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!!busy}
                    onClick={() => setDeleting(server)}
                  >
                    <Trash2Icon data-icon="inline-start" />
                    {t('删除')}
                  </Button>
                </div>
                {result && (
                  <Alert variant={result.status === 'connected' ? 'default' : 'destructive'}>
                    <AlertDescription aria-live="polite">
                      {t(result.message)}
                      {result.status === 'connected' && ` · ${result.durationMs} ms`}
                    </AlertDescription>
                  </Alert>
                )}
              </section>
            )
          })}
        </div>
      )}
      {editor && (
        <McpEditor server={editor.server} onClose={() => setEditor(null)} onSave={change} />
      )}
      {selectedAuthServer && (
        <McpAuthDialog
          key={selectedAuthServer.name}
          server={selectedAuthServer}
          result={results[selectedAuthServer.name]}
          snapshot={auth}
          reauthorize={reauthorizing}
          onClose={() => setAuthServer(null)}
          onSaveToken={saveToken}
        />
      )}
      <AlertDialog
        open={!!signingOut}
        onOpenChange={(open) => {
          if (!open && !busy) setSigningOut(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('退出 MCP 认证')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('清除“{name}”保存在 eli 中的认证信息，保留服务配置。之后可以重新授权。', {
                name: signingOut?.name ?? ''
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!busy}>{t('取消')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={!!busy}
              onClick={(event) => {
                event.preventDefault()
                if (signingOut)
                  void perform(`sign-out:${signingOut.name}`, async () => {
                    const next = await window.mcpAuth.signOut(signingOut.name)
                    if (active.current) {
                      setServers(next)
                      setSigningOut(null)
                    }
                  })
              }}
            >
              {t('退出认证')}
            </AlertDialogAction>
          </AlertDialogFooter>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{t(error)}</AlertDescription>
            </Alert>
          )}
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('删除 MCP 服务')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('删除“{name}”的 MCP 配置。之后可以重新添加。', { name: deleting?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!busy}>{t('取消')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={!!busy}
              onClick={(event) => {
                event.preventDefault()
                if (deleting)
                  void perform(deleting.name, async () => {
                    await change({
                      action: 'delete',
                      name: deleting.name,
                      expected: deleting.config
                    })
                    if (active.current) setDeleting(null)
                  })
              }}
            >
              {t('删除')}
            </AlertDialogAction>
          </AlertDialogFooter>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{t(error)}</AlertDescription>
            </Alert>
          )}
        </AlertDialogContent>
      </AlertDialog>
      <Dialog
        open={!!tools}
        onOpenChange={(open) => {
          if (!open) setTools(null)
        }}
      >
        <DialogContent className="max-h-[80dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t('MCP 工具列表')}</DialogTitle>
            <DialogDescription>
              {tools?.name} · {t('{count} 个工具', { count: tools?.result.tools.length ?? 0 })}
            </DialogDescription>
          </DialogHeader>
          {!tools?.result.tools.length ? (
            <p className="text-sm text-muted-foreground">{t('此服务未提供工具。')}</p>
          ) : (
            <div className="flex flex-col gap-4">
              {tools.result.tools.map((tool) => (
                <section key={tool.name} className="flex min-w-0 flex-col gap-2">
                  <h4 className="break-all text-sm font-medium">{tool.name}</h4>
                  {tool.description && (
                    <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
                      {tool.description}
                    </p>
                  )}
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer">{t('参数结构')}</summary>
                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all">
                      {JSON.stringify(tool.inputSchema, null, 2)}
                    </pre>
                  </details>
                </section>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}
