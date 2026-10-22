import { useState } from 'react'
import {
  PlusIcon,
  SearchIcon,
  RefreshCwIcon,
  Trash2Icon,
  PencilIcon,
  KeyRoundIcon,
  LogInIcon,
  LogOutIcon
} from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Badge } from '@renderer/components/ui/badge'
import { Input } from '@renderer/components/ui/input'
import { Switch } from '@renderer/components/ui/switch'
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
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@renderer/components/ui/empty'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { Spinner } from '@renderer/components/ui/spinner'
import { Separator } from '@renderer/components/ui/separator'
import { useLanguage } from '@renderer/hooks/use-language'
import { useProviders } from '@renderer/hooks/use-providers'
import {
  providerApis,
  type ProviderApi,
  type ProviderView,
  type ProviderModelInput,
  type ProviderChange
} from '../../../shared/providers'
import type { AgentAuthSnapshot } from '../../../shared/agent-auth'
import '../assets/providers.css'

type Change = (change: ProviderChange) => Promise<boolean>
export interface ProviderAuthController {
  snapshot: AgentAuthSnapshot | null
  error: string | null
  perform: (action: () => Promise<unknown>) => Promise<boolean>
}

function ProviderCreateDialog({
  onClose,
  change,
  pending,
  error
}: {
  onClose: () => void
  change: Change
  pending: boolean
  error: string | null
}): React.JSX.Element {
  const { t } = useLanguage()
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [api, setApi] = useState<ProviderApi>('openai-completions')
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('添加模型供应商')}</DialogTitle>
          <DialogDescription>{t('连接兼容的模型 API，凭据仅保存在 eli。')}</DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            if (await change({ action: 'create', id, name, baseUrl, api })) onClose()
          }}
        >
          <FieldGroup>
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
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
                {t('取消')}
              </Button>
              <Button type="submit" disabled={pending}>
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
  const update = (patch: Partial<ProviderModelInput>): void =>
    setModel((current) => ({ ...current, ...patch }))
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
                onCheckedChange={(reasoning) => update({ reasoning })}
              />
            </Field>
            <Field orientation="horizontal">
              <FieldLabel htmlFor="model-vision">{t('支持图片输入')}</FieldLabel>
              <Switch
                id="model-vision"
                checked={model.vision}
                onCheckedChange={(vision) => update({ vision })}
              />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
                {t('取消')}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Spinner data-icon="inline-start" />}
                {t('保存')}
              </Button>
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
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl)
  const [query, setQuery] = useState('')
  const [modelEditor, setModelEditor] = useState<{ model: ProviderModelInput | null } | null>(null)
  const [removing, setRemoving] = useState<ProviderChange | null>(null)
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
    <div className="flex flex-col gap-6 p-5">
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
          <Field>
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
              onChange={(event) => setKey(event.target.value)}
              placeholder={t(
                provider.apiKeyConfigured ? '输入新密钥以替换，已保存的密钥不回显' : '输入 API Key'
              )}
              disabled={disabled}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={disabled || !key.trim()}
                onClick={async () => {
                  if (await change({ action: 'saveKey', id: provider.id, key })) setKey('')
                }}
              >
                <KeyRoundIcon data-icon="inline-start" />
                {t('保存密钥')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() =>
                  void auth.perform(() => window.agentAuth.login(provider.id, 'api_key'))
                }
              >
                {t('引导配置')}
              </Button>
              {provider.apiKeyConfigured && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() =>
                    setRemoving({ action: 'logout', id: provider.id, type: 'api_key' })
                  }
                >
                  {t('移除密钥')}
                </Button>
              )}
            </div>
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
        <Field>
          <FieldLabel htmlFor={`api-url-${provider.id}`}>{t('API 地址')}</FieldLabel>
          <div className="flex items-center gap-2">
            <Input
              id={`api-url-${provider.id}`}
              value={provider.authMode === 'oauth' ? t('由供应商授权决定') : baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              disabled={disabled || provider.authMode === 'oauth'}
              placeholder="https://api.example.com/v1"
            />
            <Button
              variant="outline"
              size="sm"
              disabled={
                disabled ||
                provider.authMode === 'oauth' ||
                baseUrl === provider.baseUrl ||
                !baseUrl.trim()
              }
              onClick={() => void change({ action: 'update', id: provider.id, baseUrl })}
            >
              {t('保存')}
            </Button>
          </div>
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
        {!models.length ? (
          <Empty className="p-4">
            <EmptyHeader>
              <EmptyTitle>{t('暂无模型')}</EmptyTitle>
              <EmptyDescription>{t('同步模型列表，或手动添加模型 ID。')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col divide-y rounded-lg border">
            {models.map((model) => (
              <div key={model.id} className="flex items-center gap-2 px-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium" title={model.name}>
                    {model.name}
                  </div>
                  <div className="truncate text-xs text-muted-foreground" title={model.id}>
                    {model.id}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {model.reasoning && <Badge variant="outline">{t('思考')}</Badge>}
                    {model.vision && <Badge variant="outline">{t('图片')}</Badge>}
                    <span className="text-xs text-muted-foreground">
                      {Math.round(model.contextWindow / 1000)}k
                    </span>
                  </div>
                </div>
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
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`${t('编辑模型')} ${model.name}`}
                  disabled={disabled}
                  onClick={() => setModelEditor({ model })}
                >
                  <PencilIcon />
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`${t('移除模型')} ${model.name}`}
                  disabled={disabled}
                  onClick={() =>
                    setRemoving({ action: 'removeModel', id: provider.id, modelId: model.id })
                  }
                >
                  <Trash2Icon />
                </Button>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {t('同步接口未提供能力信息时使用默认 token 上限，可在模型编辑中调整。')}
        </p>
      </div>
      {provider.custom && (
        <Button
          className="self-start"
          variant="destructive"
          size="sm"
          disabled={disabled}
          onClick={() => setRemoving({ action: 'delete', id: provider.id })}
        >
          <Trash2Icon data-icon="inline-start" />
          {t('删除供应商')}
        </Button>
      )}
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
                removing?.action === 'delete'
                  ? '删除此供应商及其在 eli 中保存的凭据与模型配置。'
                  : removing?.action === 'logout'
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
  const providers = result.data?.providers ?? []
  const visible = providers.filter((provider) =>
    `${provider.id} ${provider.name}`.toLowerCase().includes(query.toLowerCase())
  )
  const provider = providers.find((item) => item.id === selected) ?? visible[0]
  const error =
    result.error || auth.error || (auth.snapshot?.status === 'error' ? auth.snapshot.error : null)
  return (
    <div className="provider-layout flex min-h-0 flex-1 flex-col">
      {error && (
        <Alert variant="destructive" className="mx-5 mb-3 w-auto">
          <AlertDescription className="break-words">{error}</AlertDescription>
        </Alert>
      )}
      {result.loading ? (
        <div className="flex flex-1 items-center justify-center gap-2">
          <Spinner />
          {t('正在加载供应商…')}
        </div>
      ) : (
        <div className="provider-split min-h-0 flex-1">
          <aside className="provider-list flex min-h-0 flex-col gap-3 border-r p-3">
            <InputGroup>
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
              <InputGroupInput
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('搜索供应商')}
              />
            </InputGroup>
            <ScrollArea className="min-h-0 flex-1">
              <div className="flex flex-col gap-1">
                {visible.map((item) => (
                  <Button
                    key={item.id}
                    variant={provider?.id === item.id ? 'secondary' : 'ghost'}
                    className="h-auto min-h-9 justify-between gap-2 px-2 py-2"
                    aria-pressed={provider?.id === item.id}
                    onClick={() => setSelected(item.id)}
                  >
                    <span className="min-w-0 truncate">{item.name}</span>
                    {item.enabled &&
                      (item.authMode === 'oauth'
                        ? item.oauthConfigured
                        : item.apiKeyConfigured) && <KeyRoundIcon data-icon="inline-end" />}
                  </Button>
                ))}
              </div>
            </ScrollArea>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAdding(true)}
              disabled={result.pending}
            >
              <PlusIcon data-icon="inline-start" />
              {t('添加供应商')}
            </Button>
          </aside>
          <ScrollArea className="min-h-0 min-w-0">
            {provider ? (
              <ProviderDetail
                key={provider.id}
                provider={provider}
                change={result.change}
                pending={result.pending}
                auth={auth}
                error={result.error}
              />
            ) : (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>{t('未找到供应商')}</EmptyTitle>
                </EmptyHeader>
              </Empty>
            )}
          </ScrollArea>
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
          onClose={() => setAdding(false)}
          change={result.change}
          pending={result.pending}
          error={result.error}
        />
      )}
    </div>
  )
}
