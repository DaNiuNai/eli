import { useState } from 'react'
import {
  PlusIcon,
  SearchIcon,
  RefreshCwIcon,
  Trash2Icon,
  PencilIcon,
  LogInIcon,
  LogOutIcon
} from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Badge } from '@renderer/components/ui/badge'
import { Input } from '@renderer/components/ui/input'
import { Switch } from '@renderer/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@renderer/components/ui/field'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@renderer/components/ui/dialog'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem
} from '@renderer/components/ui/select'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@renderer/components/ui/input-group'
import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@renderer/components/ui/alert-dialog'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@renderer/components/ui/empty'
import { Spinner } from '@renderer/components/ui/spinner'
import { Separator } from '@renderer/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@renderer/components/ui/table'
import { useLanguage } from '@renderer/hooks/use-language'
import { useProviders } from '@renderer/hooks/use-providers'
import { useAutoSave } from '@renderer/hooks/use-auto-save'
import { AutoSaveStatus } from '@renderer/components/AutoSaveStatus'
import {
  providerApis,
  type ProviderApi,
  type ProviderView,
  type ProviderModelInput,
  type ProviderChange
} from '../../../shared/providers'
import type { AgentAuthSnapshot } from '../../../shared/agent-auth'

type Change = (change: ProviderChange) => Promise<boolean>
export interface ProviderAuthController {
  snapshot: AgentAuthSnapshot | null
  error: string | null
  perform: (action: () => Promise<unknown>) => Promise<boolean>
}

function DeleteProviderAction({
  provider,
  change,
  disabled,
  beforeDelete,
  variant = 'ghost'
}: {
  provider: ProviderView
  change: Change
  disabled: boolean
  beforeDelete?: () => Promise<void>
  variant?: 'ghost' | 'destructive'
}): React.JSX.Element {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove(): Promise<void> {
    if (disabled || deleting) return
    setDeleting(true)
    setError(null)
    try {
      await beforeDelete?.()
      if (await change({ action: 'delete', id: provider.id })) setOpen(false)
      else setError('删除供应商失败，请重试。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (deleting) return
        setOpen(next)
        setError(null)
      }}
    >
      <AlertDialogTrigger
        render={<Button variant={variant} size="icon-sm" className="self-start" />}
        disabled={disabled}
        aria-label={`${t('删除供应商')} ${provider.name}`}
        title={`${t('删除供应商')} ${provider.name}`}
      >
        <Trash2Icon />
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('删除供应商？')}</AlertDialogTitle>
          <AlertDialogDescription className="break-words">
            {t('将删除“{name}”及其在 eli 中保存的凭据和模型配置。之后可重新添加。', {
              name: provider.name
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{t(error)}</AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>{t('取消')}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={disabled || deleting}
            onClick={() => void remove()}
          >
            {deleting && <Spinner data-icon="inline-start" />}
            {t(deleting ? '正在删除…' : '删除供应商')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function ProviderCreateDialog({
  providers,
  onAdded,
  onClose,
  change,
  pending,
  error
}: {
  providers: ProviderView[]
  onAdded: (id: string) => void
  onClose: () => void
  change: Change
  pending: boolean
  error: string | null
}): React.JSX.Element {
  const { t } = useLanguage()
  const [kind, setKind] = useState<'builtin' | 'custom'>('builtin')
  const [builtinId, setBuiltinId] = useState<string | null>(null)
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [api, setApi] = useState<ProviderApi>('openai-completions')
  const available = providers.filter(
    (provider) =>
      !provider.custom && !provider.added && (provider.apiKeySupported || provider.oauthSupported)
  )
  const builtin = available.find((provider) => provider.id === builtinId)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('添加模型供应商')}</DialogTitle>
          <DialogDescription>{t('选择内置供应商，或连接自定义模型 API。')}</DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            if (kind === 'builtin') {
              if (builtin && (await change({ action: 'addBuiltin', id: builtin.id })))
                onAdded(builtin.id)
            } else if (await change({ action: 'create', id, name, baseUrl, api }))
              onAdded(id.trim())
          }}
        >
          <FieldGroup>
            <Field data-disabled={pending}>
              <FieldLabel id="provider-kind-label">{t('供应商类型')}</FieldLabel>
              <ToggleGroup
                multiple={false}
                value={[kind]}
                variant="outline"
                spacing={0}
                className="grid w-full grid-cols-2"
                aria-labelledby="provider-kind-label"
                disabled={pending}
                onValueChange={([value]) => {
                  if (value === 'builtin' || value === 'custom') setKind(value)
                }}
              >
                <ToggleGroupItem value="builtin">{t('内置供应商')}</ToggleGroupItem>
                <ToggleGroupItem value="custom">{t('自定义供应商')}</ToggleGroupItem>
              </ToggleGroup>
            </Field>
            {kind === 'builtin' ? (
              available.length ? (
                <Field data-disabled={pending}>
                  <FieldLabel htmlFor="builtin-provider">{t('选择内置供应商')}</FieldLabel>
                  <Select
                    items={available.map((provider) => ({
                      value: provider.id,
                      label: provider.name
                    }))}
                    value={builtinId}
                    onValueChange={setBuiltinId}
                    disabled={pending}
                  >
                    <SelectTrigger id="builtin-provider" className="w-full">
                      <SelectValue placeholder={t('请选择内置供应商')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {available.map((provider) => (
                          <SelectItem key={provider.id} value={provider.id}>
                            <span>{provider.name}</span>
                            <span className="text-xs text-muted-foreground">{provider.id}</span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    {t('沿用内置的 API 地址和模型支持，添加后可继续配置密钥或账号授权。')}
                  </FieldDescription>
                  {builtin && (
                    <div className="mt-1 flex flex-wrap gap-2">
                      {builtin.apiKeySupported && <Badge variant="outline">API Key</Badge>}
                      {builtin.oauthSupported && (
                        <Badge variant="outline">{t('订阅 / OAuth')}</Badge>
                      )}
                    </div>
                  )}
                </Field>
              ) : (
                <Empty className="py-6">
                  <EmptyHeader>
                    <EmptyTitle>{t('暂无可添加的内置供应商')}</EmptyTitle>
                    <EmptyDescription>
                      {t('已添加的供应商不会重复显示，也可以切换到自定义供应商。')}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )
            ) : (
              <>
                <Field>
                  <FieldLabel htmlFor="provider-name">{t('供应商名称')}</FieldLabel>
                  <Input
                    id="provider-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                    maxLength={200}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="provider-id">{t('供应商 ID')}</FieldLabel>
                  <Input
                    id="provider-id"
                    value={id}
                    onChange={(event) => setId(event.target.value)}
                    required
                    pattern="[a-z][a-z0-9_-]{0,63}"
                    placeholder="my-provider"
                  />
                  <FieldDescription>{t('使用小写字母、数字、连字符或下划线。')}</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="provider-api">{t('API 协议')}</FieldLabel>
                  <Select
                    items={providerApis.map((value) => ({ value, label: value }))}
                    value={api}
                    onValueChange={(value) => {
                      if (value) setApi(value)
                    }}
                  >
                    <SelectTrigger id="provider-api">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {providerApis.map((value) => (
                          <SelectItem key={value} value={value}>
                            {value}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="provider-url">{t('API 地址')}</FieldLabel>
                  <Input
                    id="provider-url"
                    type="url"
                    value={baseUrl}
                    onChange={(event) => setBaseUrl(event.target.value)}
                    placeholder="https://api.example.com/v1"
                    required
                  />
                </Field>
              </>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
                {t('取消')}
              </Button>
              <Button type="submit" disabled={pending || (kind === 'builtin' && !builtin)}>
                {pending && <Spinner data-icon="inline-start" />}
                {t('添加')}
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ModelDialog({
  provider,
  initial,
  onClose,
  change,
  pending,
  error
}: {
  provider: ProviderView
  initial: ProviderModelInput | null
  onClose: () => void
  change: Change
  pending: boolean
  error: string | null
}): React.JSX.Element {
  const { t } = useLanguage()
  const [model, setModel] = useState<ProviderModelInput>(
    initial ?? {
      id: '',
      name: '',
      reasoning: false,
      vision: false,
      contextWindow: 128000,
      maxTokens: 8192
    }
  )
  const autoSave = useAutoSave<ProviderModelInput>(async (_key, value) => {
    if (
      !Number.isSafeInteger(value.contextWindow) ||
      value.contextWindow < 1 ||
      value.contextWindow > 100000000 ||
      !Number.isSafeInteger(value.maxTokens) ||
      value.maxTokens < 1 ||
      value.maxTokens > value.contextWindow
    )
      throw new Error('请输入有效的上下文窗口和输出 token 上限。')
    if (
      !(await change({
        action: 'saveModel',
        id: provider.id,
        model: { ...value, name: value.name.trim() || value.id }
      }))
    ) {
      throw new Error('自动保存失败，请重试。')
    }
  })
  const update = (patch: Partial<ProviderModelInput>, immediate = false): void => {
    const next = { ...model, ...patch }
    setModel(next)
    if (initial) autoSave.update('model', next, immediate ? 0 : 400)
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(initial ? '编辑模型' : '添加模型')}</DialogTitle>
          <DialogDescription>{t('填写供应商实际支持的模型 ID 与能力。')}</DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            if (initial) {
              await autoSave.flush()
              return
            }
            if (
              await change({
                action: 'saveModel',
                id: provider.id,
                model: { ...model, name: model.name.trim() || model.id }
              })
            )
              onClose()
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="model-id">{t('模型 ID')}</FieldLabel>
              <Input
                id="model-id"
                value={model.id}
                required
                disabled={!!initial}
                onChange={(event) => update({ id: event.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="model-name">{t('显示名称')}</FieldLabel>
              <Input
                id="model-name"
                value={model.name}
                placeholder={model.id}
                onChange={(event) => update({ name: event.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="model-context">{t('上下文窗口')}</FieldLabel>
              <Input
                id="model-context"
                type="number"
                min={1}
                max={100000000}
                value={model.contextWindow}
                onChange={(event) => update({ contextWindow: Number(event.target.value) })}
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="model-output">{t('最大输出 token')}</FieldLabel>
              <Input
                id="model-output"
                type="number"
                min={1}
                max={model.contextWindow}
                value={model.maxTokens}
                onChange={(event) => update({ maxTokens: Number(event.target.value) })}
                required
              />
            </Field>
            <Field orientation="horizontal">
              <FieldLabel htmlFor="model-thinking">{t('支持思考')}</FieldLabel>
              <Switch
                id="model-thinking"
                checked={model.reasoning}
                onCheckedChange={(reasoning) => update({ reasoning }, true)}
              />
            </Field>
            <Field orientation="horizontal">
              <FieldLabel htmlFor="model-vision">{t('支持图片输入')}</FieldLabel>
              <Switch
                id="model-vision"
                checked={model.vision}
                onCheckedChange={(vision) => update({ vision }, true)}
              />
            </Field>
            {initial && (
              <AutoSaveStatus
                state={autoSave.states.model}
                onRetry={() => autoSave.update('model', model, 0)}
              />
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
                {t(initial ? '关闭' : '取消')}
              </Button>
              {!initial && (
                <Button type="submit" disabled={pending}>
                  {pending && <Spinner data-icon="inline-start" />}
                  {t('添加模型')}
                </Button>
              )}
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ProviderDetail({
  provider,
  change,
  pending,
  auth,
  error
}: {
  provider: ProviderView
  change: Change
  pending: boolean
  auth: ProviderAuthController
  error: string | null
}): React.JSX.Element {
  const { t } = useLanguage()
  const [key, setKey] = useState('')
  const [name, setName] = useState(provider.name)
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl)
  const [query, setQuery] = useState('')
  const [modelEditor, setModelEditor] = useState<{ model: ProviderModelInput | null } | null>(null)
  const [removing, setRemoving] = useState<ProviderChange | null>(null)
  const autoSave = useAutoSave<string>(async (field, value) => {
    if (field === 'key' && !value.trim()) return
    const success = await change(
      field === 'key'
        ? { action: 'saveKey', id: provider.id, key: value }
        : {
            action: 'update',
            id: provider.id,
            ...(field === 'name' ? { name: value } : { baseUrl: value })
          }
    )
    if (!success) throw new Error('自动保存失败，请重试。')
  })
  const loggingIn = auth.snapshot?.status === 'logging-in'
  const disabled = pending || loggingIn
  const modes = [
    provider.apiKeySupported ? { value: 'api_key', label: 'API Key' } : null,
    provider.oauthSupported ? { value: 'oauth', label: t('订阅 / OAuth') } : null
  ].filter((item): item is { value: string; label: string } => !!item)
  const models = provider.models.filter((model) =>
    `${model.name} ${model.id}`.toLowerCase().includes(query.toLowerCase())
  )
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="truncate text-base font-semibold">{provider.name}</h3>
          <p className="text-xs text-muted-foreground">{provider.id}</p>
          <Badge variant="outline" className="self-start">
            {t(provider.custom ? '自定义供应商' : '内置供应商')}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {t(provider.enabled ? '已启用' : '已停用')}
          </span>
          <Switch
            aria-label={t('启用供应商')}
            checked={provider.enabled}
            disabled={disabled}
            onCheckedChange={(enabled) =>
              void change({ action: 'update', id: provider.id, enabled })
            }
          />
        </div>
      </div>
      <FieldGroup className="gap-4">
        <Field data-invalid={autoSave.states.name?.status === 'error'}>
          <FieldLabel htmlFor={`provider-name-${provider.id}`}>{t('供应商名称')}</FieldLabel>
          <Input
            id={`provider-name-${provider.id}`}
            value={name}
            disabled={loggingIn}
            aria-invalid={autoSave.states.name?.status === 'error'}
            onChange={(event) => {
              setName(event.target.value)
              autoSave.update('name', event.target.value)
            }}
            onBlur={() => void autoSave.flush()}
            maxLength={200}
          />
          <AutoSaveStatus
            state={autoSave.states.name}
            onRetry={() => autoSave.update('name', name, 0)}
          />
        </Field>
        {modes.length > 0 && (
          <Field>
            <FieldLabel htmlFor={`auth-mode-${provider.id}`}>{t('使用的认证方式')}</FieldLabel>
            <Select
              items={modes}
              value={provider.authMode}
              disabled={disabled}
              onValueChange={(mode) => {
                if (mode === 'api_key' || mode === 'oauth')
                  void change({ action: 'update', id: provider.id, authMode: mode })
              }}
            >
              <SelectTrigger id={`auth-mode-${provider.id}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {modes.map((mode) => (
                    <SelectItem key={mode.value} value={mode.value}>
                      {mode.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldDescription>{t('两种凭据独立保存，模型请求仅使用当前选择。')}</FieldDescription>
          </Field>
        )}
        {provider.apiKeySupported && (
          <Field data-invalid={autoSave.states.key?.status === 'error'}>
            <div className="flex items-center justify-between gap-2">
              <FieldLabel htmlFor={`api-key-${provider.id}`}>API Key</FieldLabel>
              <Badge variant={provider.apiKeyConfigured ? 'secondary' : 'outline'}>
                {t(provider.apiKeyConfigured ? '已保存' : '未配置')}
              </Badge>
            </div>
            <Input
              id={`api-key-${provider.id}`}
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              value={key}
              aria-invalid={autoSave.states.key?.status === 'error'}
              onChange={(event) => {
                setKey(event.target.value)
                autoSave.update('key', event.target.value)
              }}
              onBlur={() => void autoSave.flush()}
              placeholder={t(
                provider.apiKeyConfigured ? '输入新密钥以替换，已保存的密钥不回显' : '输入 API Key'
              )}
              disabled={loggingIn}
            />
            {provider.apiKeyConfigured && (
              <Button
                size="sm"
                variant="ghost"
                className="self-start"
                disabled={disabled}
                onClick={() => setRemoving({ action: 'logout', id: provider.id, type: 'api_key' })}
              >
                {t('移除密钥')}
              </Button>
            )}
            <AutoSaveStatus
              state={key ? autoSave.states.key : undefined}
              onRetry={() => autoSave.update('key', key, 0)}
            />
          </Field>
        )}
        {provider.oauthSupported && (
          <Field>
            <div className="flex items-center justify-between gap-2">
              <FieldLabel>{provider.oauthName ?? t('订阅 / OAuth')}</FieldLabel>
              <Badge variant={provider.oauthConfigured ? 'secondary' : 'outline'}>
                {t(provider.oauthConfigured ? '已授权' : '未登录')}
              </Badge>
            </div>
            <FieldDescription>
              {t('授权状态独立于 API Key，令牌刷新由供应商 SDK 处理。')}
            </FieldDescription>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() =>
                  void auth.perform(() => window.agentAuth.login(provider.id, 'oauth'))
                }
              >
                <LogInIcon data-icon="inline-start" />
                {t(provider.oauthConfigured ? '重新授权' : '登录订阅')}
              </Button>
              {provider.oauthConfigured && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  onClick={() => setRemoving({ action: 'logout', id: provider.id, type: 'oauth' })}
                >
                  <LogOutIcon data-icon="inline-start" />
                  {t('退出登录')}
                </Button>
              )}
            </div>
          </Field>
        )}
        {!modes.length && (
          <Alert>
            <AlertDescription>
              {t('此供应商仅支持外部凭据发现，eli 已禁用该方式。请添加显式配置的兼容供应商。')}
            </AlertDescription>
          </Alert>
        )}
      </FieldGroup>
      <Separator />
      <FieldGroup>
        <Field data-invalid={autoSave.states.baseUrl?.status === 'error'}>
          <FieldLabel htmlFor={`api-url-${provider.id}`}>{t('API 地址')}</FieldLabel>
          <Input
            id={`api-url-${provider.id}`}
            value={provider.authMode === 'oauth' ? t('由供应商授权决定') : baseUrl}
            aria-invalid={autoSave.states.baseUrl?.status === 'error'}
            onChange={(event) => {
              setBaseUrl(event.target.value)
              autoSave.update('baseUrl', event.target.value)
            }}
            onBlur={() => void autoSave.flush()}
            disabled={loggingIn || provider.authMode === 'oauth'}
            placeholder="https://api.example.com/v1"
          />
          <AutoSaveStatus
            state={autoSave.states.baseUrl}
            onRetry={() => autoSave.update('baseUrl', baseUrl, 0)}
          />
          <FieldDescription>
            {t(
              provider.authMode === 'oauth'
                ? '订阅授权使用供应商官方地址，不会发送至自定义 API 地址。'
                : '填写 API 根地址；OpenAI 兼容接口通常以 /v1 结尾。'
            )}
          </FieldDescription>
        </Field>
      </FieldGroup>
      <Separator />
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold">
            {t('模型')}{' '}
            <span className="text-muted-foreground">
              {provider.models.filter((model) => model.enabled).length} / {provider.models.length}
            </span>
          </h4>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={disabled || !provider.enabled}
              onClick={() => void change({ action: 'sync', id: provider.id })}
            >
              <RefreshCwIcon data-icon="inline-start" />
              {t('同步模型')}
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label={t('添加模型')}
              disabled={disabled}
              onClick={() => setModelEditor({ model: null })}
            >
              <PlusIcon />
            </Button>
          </div>
        </div>
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('搜索模型')}
          />
        </InputGroup>
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('模型')}</TableHead>
                <TableHead>{t('能力')}</TableHead>
                <TableHead>{t('上下文窗口')}</TableHead>
                <TableHead>{t('已启用')}</TableHead>
                <TableHead className="text-right">{t('操作')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {models.map((model) => (
                <TableRow key={model.id}>
                  <TableCell>
                    <div className="flex min-w-40 max-w-64 flex-col gap-1">
                      <span className="truncate font-medium" title={model.name}>
                        {model.name}
                      </span>
                      <span className="truncate text-xs text-muted-foreground" title={model.id}>
                        {model.id}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {model.reasoning && <Badge variant="outline">{t('思考')}</Badge>}
                      {model.vision && <Badge variant="outline">{t('图片')}</Badge>}
                      {!model.reasoning && !model.vision && (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{model.contextWindow.toLocaleString()}</TableCell>
                  <TableCell>
                    <Switch
                      size="sm"
                      checked={model.enabled}
                      disabled={disabled}
                      aria-label={`${t('启用模型')} ${model.name}`}
                      onCheckedChange={(enabled) =>
                        void change({
                          action: 'setModelEnabled',
                          id: provider.id,
                          modelId: model.id,
                          enabled
                        })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`${t('编辑模型')} ${model.name}`}
                        title={`${t('编辑模型')} ${model.name}`}
                        disabled={disabled}
                        onClick={() => setModelEditor({ model })}
                      >
                        <PencilIcon />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`${t('移除模型')} ${model.name}`}
                        title={`${t('移除模型')} ${model.name}`}
                        disabled={disabled}
                        onClick={() =>
                          setRemoving({ action: 'removeModel', id: provider.id, modelId: model.id })
                        }
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!models.length && (
                <TableRow>
                  <TableCell colSpan={5}>
                    <Empty className="py-8">
                      <EmptyHeader>
                        <EmptyTitle>{t(query.trim() ? '未找到模型' : '暂无模型')}</EmptyTitle>
                        <EmptyDescription>
                          {t('同步模型列表，或手动添加模型 ID。')}
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">
          {t('同步接口未提供能力信息时使用默认 token 上限，可在模型编辑中调整。')}
        </p>
      </div>
      <DeleteProviderAction
        provider={provider}
        change={change}
        disabled={disabled}
        beforeDelete={autoSave.flush}
        variant="destructive"
      />
      {modelEditor && (
        <ModelDialog
          provider={provider}
          initial={modelEditor.model}
          onClose={() => setModelEditor(null)}
          change={change}
          pending={pending}
          error={error}
        />
      )}
      <Dialog
        open={!!removing}
        onOpenChange={(open) => {
          if (!open && !pending) setRemoving(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('确认移除')}</DialogTitle>
            <DialogDescription>
              {t(
                removing?.action === 'logout'
                  ? '仅移除选中的凭据，另一种登录方式保持不变。'
                  : '此模型将从可用模型中移除，可通过同步或重新启用恢复。'
              )}
            </DialogDescription>
          </DialogHeader>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)} disabled={pending}>
              {t('取消')}
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={async () => {
                if (removing && (await change(removing))) setRemoving(null)
              }}
            >
              {t('移除')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function ProviderSettingsPanel({
  auth
}: {
  auth: ProviderAuthController
}): React.JSX.Element {
  const { t } = useLanguage()
  const result = useProviders(auth.snapshot?.status === 'success' ? auth.snapshot.revision : 0)
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const providers = result.data?.providers.filter((item) => item.added) ?? []
  const visible = providers.filter((provider) =>
    `${provider.id} ${provider.name}`.toLowerCase().includes(query.toLowerCase())
  )
  const provider = providers.find((item) => item.id === selected)
  const error =
    result.error || auth.error || (auth.snapshot?.status === 'error' ? auth.snapshot.error : null)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {error && (
        <Alert variant="destructive" className="mx-8 mb-3 w-auto">
          <AlertDescription className="break-words">{error}</AlertDescription>
        </Alert>
      )}
      {result.loading ? (
        <div className="flex flex-1 items-center justify-center gap-2">
          <Spinner />
          {t('正在加载供应商…')}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-5 px-8 pb-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <InputGroup className="max-w-sm">
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
              <InputGroupInput
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('搜索供应商')}
                aria-label={t('搜索供应商')}
              />
            </InputGroup>
            <Button size="sm" onClick={() => setAdding(true)} disabled={result.pending}>
              <PlusIcon data-icon="inline-start" />
              {t('添加供应商')}
            </Button>
          </div>
          <div className="min-h-0 overflow-y-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('供应商')}</TableHead>
                  <TableHead>{t('API 协议与地址')}</TableHead>
                  <TableHead>{t('认证')}</TableHead>
                  <TableHead>{t('模型')}</TableHead>
                  <TableHead>{t('已启用')}</TableHead>
                  <TableHead className="text-right">{t('操作')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="flex min-w-32 max-w-48 flex-col gap-1">
                        <span className="truncate font-medium" title={item.name}>
                          {item.name}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">{item.id}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-52 flex-col gap-1">
                        <span className="truncate text-xs">{item.api}</span>
                        <span
                          className="truncate text-xs text-muted-foreground"
                          title={item.baseUrl}
                        >
                          {item.authMode === 'oauth' ? t('由供应商授权决定') : item.baseUrl || '—'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          (item.authMode === 'oauth' ? item.oauthConfigured : item.apiKeyConfigured)
                            ? 'secondary'
                            : 'outline'
                        }
                      >
                        {t(
                          (item.authMode === 'oauth' ? item.oauthConfigured : item.apiKeyConfigured)
                            ? '已配置'
                            : '未配置'
                        )}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {item.models.filter((model) => model.enabled).length} / {item.models.length}
                    </TableCell>
                    <TableCell>
                      <Switch
                        size="sm"
                        checked={item.enabled}
                        disabled={result.pending || auth.snapshot?.status === 'logging-in'}
                        aria-label={`${t('启用供应商')} ${item.name}`}
                        onCheckedChange={(enabled) =>
                          void result.change({ action: 'update', id: item.id, enabled })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setSelected(item.id)}
                          aria-label={`${t('编辑供应商')} ${item.name}`}
                          title={`${t('编辑供应商')} ${item.name}`}
                        >
                          <PencilIcon />
                        </Button>
                        <DeleteProviderAction
                          provider={item}
                          change={result.change}
                          disabled={result.pending || auth.snapshot?.status === 'logging-in'}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {!visible.length && (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <Empty className="py-12">
                        <EmptyHeader>
                          <EmptyTitle>{t(query.trim() ? '未找到供应商' : '暂无供应商')}</EmptyTitle>
                          <EmptyDescription>
                            {t('点击“添加供应商”，连接你要使用的模型服务。')}
                          </EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
      {result.pending && (
        <p
          role="status"
          className="flex items-center gap-2 border-t px-5 py-2 text-xs text-muted-foreground"
        >
          <Spinner />
          {t('正在更新供应商…')}
        </p>
      )}
      {adding && (
        <ProviderCreateDialog
          providers={result.data?.providers ?? []}
          onAdded={(id) => {
            setAdding(false)
            setQuery('')
            setSelected(id)
          }}
          onClose={() => setAdding(false)}
          change={result.change}
          pending={result.pending}
          error={result.error}
        />
      )}
      {provider && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setSelected(null)
          }}
        >
          <DialogContent className="flex max-h-[85dvh] flex-col overflow-hidden p-0 sm:max-w-3xl">
            <DialogHeader className="shrink-0 px-6 pt-6 pb-4 pr-12">
              <DialogTitle>{t('编辑模型供应商')}</DialogTitle>
              <DialogDescription>
                {t('修改后自动保存，可配置认证方式、API 地址及模型。')}
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 overflow-y-auto px-6 pb-6">
              {error && (
                <Alert variant="destructive" className="mb-4">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <ProviderDetail
                key={provider.id}
                provider={provider}
                change={result.change}
                pending={result.pending}
                auth={auth}
                error={result.error}
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
