import { useContext, useEffect, useState } from 'react'
import {
  DownloadIcon,
  FolderIcon,
  PackageIcon,
  RefreshCwIcon,
  SearchIcon,
  Settings2Icon
} from 'lucide-react'
import { Button } from './ui/button'
import { Switch } from './ui/switch'
import { Badge } from './ui/badge'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog'
import { InputGroup, InputGroupAddon, InputGroupInput } from './ui/input-group'
import { NativeSelect, NativeSelectOption } from './ui/native-select'
import { Alert, AlertDescription } from './ui/alert'
import { Empty, EmptyHeader, EmptyTitle } from './ui/empty'
import { Field, FieldGroup, FieldLabel } from './ui/field'
import { Spinner } from './ui/spinner'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel
} from './ui/alert-dialog'
import { useLanguage } from '../hooks/use-language'
import { pluginTitle } from '../plugins/plugin-titles'
import { DshSlot } from '../plugins/dsh-slots'
import { ClientApplication } from '../plugins/context'
import {
  pluginProfiles,
  type PluginChange,
  type PluginInventory,
  type PluginProfile
} from '../../../shared/plugins'

const scopes: Record<PluginProfile, string> = {
  session: '会话引擎',
  control: '控制服务',
  'session-host': '会话宿主',
  client: '聊天界面',
  desktop: '桌面服务'
}

export function PluginsPanel(): React.JSX.Element {
  const application = useContext(ClientApplication)
  const clientStates = new Map(application?.status().map((entry) => [entry.id, entry.state]))
  const { t, language } = useLanguage()
  const [data, setData] = useState<PluginInventory>()
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState('')
  const [source, setSource] = useState('')
  const [target, setTarget] = useState<PluginProfile>('session')
  const [installing, setInstalling] = useState(false)
  const [confirmation, setConfirmation] = useState<Extract<PluginChange, { kind: 'remove' }>>()
  const [versions, setVersions] = useState<{ name: string; list: string[]; selected: string }>()
  const [revision, setRevision] = useState(0)
  const [editor, setEditor] = useState<{
    profile: PluginProfile
    id: string
    text: string
    error?: string
  }>()
  useEffect(() => {
    let active = true
    window.plugins.inventory().then(
      (value) => {
        if (active) setData(value)
      },
      (cause) => {
        if (active) setError(String(cause))
      }
    )
    return () => {
      active = false
    }
  }, [revision])

  async function change(action: PluginChange): Promise<void> {
    setBusy(true)
    setError('')
    setNotice('')
    setConfirmation(undefined)
    try {
      const result = await window.plugins.change(action)
      setData(result.inventory)
      setRevision((n) => n + 1)
      setEditor(undefined)
      setNotice(t(result.notice))
      setVersions(undefined)
      if (action.kind === 'install' && result.notice !== '已取消安装') {
        setInstalling(false)
        setSource('')
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      if (action.kind === 'configure')
        setEditor((current) => current && { ...current, error: message })
      setRevision((n) => n + 1)
    } finally {
      setBusy(false)
    }
  }
  async function loadVersions(name: string, current: string): Promise<void> {
    setBusy(true)
    setError('')
    try {
      const list = await window.plugins.versions(name)
      setVersions({ name, list, selected: list.find((it) => it !== current) ?? current })
    } catch (cause) {
      setError(String(cause))
    } finally {
      setBusy(false)
    }
  }
  const matches = (...words: string[]): boolean =>
    words.join(' ').toLowerCase().includes(query.trim().toLowerCase())
  const rows = data?.entries.filter(
    (row) =>
      (!scope || row.profile === scope) &&
      matches(row.id, row.name, pluginTitle(row, language), row.owner ?? '', t(scopes[row.profile]))
  )
  const packages = data?.packages.filter(
    (pkg) =>
      (!scope || pkg.entries[scope as PluginProfile]) &&
      matches(pkg.name, pkg.description, pkg.source)
  )
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <InputGroup className="min-w-36 flex-1">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            aria-label={t('搜索插件')}
            placeholder={t('搜索插件')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </InputGroup>
        <NativeSelect
          aria-label={t('插件作用域')}
          value={scope}
          onChange={(e) => setScope(e.target.value)}
        >
          <NativeSelectOption value="">{t('全部作用域')}</NativeSelectOption>
          {pluginProfiles.map((p) => (
            <NativeSelectOption key={p} value={p}>
              {t(scopes[p])}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t('重新加载')}
          disabled={busy}
          onClick={() => {
            setError('')
            setRevision((n) => n + 1)
          }}
        >
          <RefreshCwIcon />
        </Button>
        <Button size="sm" disabled={busy} onClick={() => setInstalling(!installing)}>
          <DownloadIcon data-icon="inline-start" />
          {t('安装插件')}
        </Button>
      </div>
      {installing && (
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="plugin-source">{t('插件来源')}</FieldLabel>
            <div className="flex gap-2">
              <Input
                id="plugin-source"
                value={source}
                disabled={busy}
                onChange={(e) => setSource(e.target.value)}
                placeholder={t('npm 包名、HTTPS Git 地址或本地包目录')}
              />
              <Button
                size="icon"
                variant="outline"
                aria-label={t('选择本地插件目录')}
                disabled={busy}
                onClick={() =>
                  void window.plugins.chooseDirectory().then(
                    (path) => {
                      if (path) setSource(path)
                    },
                    (err) => setError(String(err))
                  )
                }
              >
                <FolderIcon />
              </Button>
            </div>
          </Field>
          <Field>
            <FieldLabel htmlFor="plugin-target">{t('安装作用域')}</FieldLabel>
            <NativeSelect
              id="plugin-target"
              value={target}
              onChange={(e) => setTarget(e.target.value as PluginProfile)}
            >
              {pluginProfiles.map((p) => (
                <NativeSelectOption key={p} value={p}>
                  {t(scopes[p])}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Button
            size="sm"
            className="self-start"
            disabled={busy || !source.trim()}
            onClick={() => void change({ kind: 'install', source: source.trim(), profile: target })}
          >
            {t('继续安装')}
          </Button>
          <DshSlot name="plugins.add.actions" owner={{ onDismiss: () => setInstalling(false) }} />
        </FieldGroup>
      )}
      {busy && (
        <div role="status" className="flex items-center gap-2 text-sm">
          <Spinner />
          {t('正在处理插件操作…')}
        </div>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {(data?.startupError || application?.ctx.get('clientStartupError')) && (
        <Alert variant="destructive">
          <AlertDescription>
            {t('已用内置插件恢复界面。')}{' '}
            {data?.startupError || application?.ctx.get('clientStartupError')}
          </AlertDescription>
        </Alert>
      )}
      {notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}
      {!data && !error && <Spinner />}
      {!!packages?.length && (
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">{t('已安装的插件包')}</h3>
          {packages.map((pkg) => {
            const ref = {
              name: pkg.name,
              version: pkg.version,
              installed: true,
              availability: 'profile',
              official: false,
              enabled: pkg.enabled,
              rows: Object.entries(pkg.modules ?? {}).map(([rowId, moduleName]) => ({
                rowId,
                moduleName,
                enabled:
                  pkg.enabled &&
                  !!data?.entries.some(
                    (row) => row.owner === pkg.name && row.id === rowId && !row.disabled
                  )
              }))
            }
            const owner = { subject: { kind: 'bundle', pkg: ref } }
            return (
              <article key={pkg.name} className="flex flex-col gap-2 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <PackageIcon className="size-4" />
                  <strong className="min-w-0 flex-1 break-all text-sm">{pkg.name}</strong>
                  <Badge variant="secondary">{pkg.version}</Badge>
                  <DshSlot name="plugins.detail.badge" owner={owner} />
                  <Switch
                    checked={pkg.enabled}
                    disabled={busy}
                    aria-label={t('启用插件') + ' ' + pkg.name}
                    onCheckedChange={(enabled) =>
                      void change({ kind: 'enable', name: pkg.name, enabled })
                    }
                  />
                </div>
                {pkg.description && <p className="text-sm">{pkg.description}</p>}
                <p className="break-all text-xs text-muted-foreground">{pkg.source}</p>
                <DshSlot
                  name="plugins.bundle.config"
                  owner={{ view: 'page' }}
                  entryKey={pkg.name}
                />
                <div className="flex flex-wrap gap-2">
                  <DshSlot name="plugins.detail.actions" owner={owner} />
                  {(pkg.source === pkg.name || pkg.source.startsWith(pkg.name + '@')) && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => void loadVersions(pkg.name, pkg.version)}
                    >
                      {t('管理版本')}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => setConfirmation({ kind: 'remove', name: pkg.name })}
                  >
                    {t('卸载')}
                  </Button>
                </div>
                {versions?.name === pkg.name && (
                  <div className="flex flex-wrap gap-2">
                    <NativeSelect
                      aria-label={t('选择版本')}
                      value={versions.selected}
                      onChange={(e) => setVersions({ ...versions, selected: e.target.value })}
                    >
                      {versions.list.map((v) => (
                        <NativeSelectOption key={v} value={v}>
                          {v}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <Button
                      size="sm"
                      disabled={busy || versions.selected === pkg.version || !versions.list.length}
                      onClick={() =>
                        void change({
                          kind: 'update',
                          name: pkg.name,
                          version: versions.selected
                        })
                      }
                    >
                      {t('切换版本')}
                    </Button>
                  </div>
                )}
                <DshSlot name="plugins.detail.section" owner={owner} />
              </article>
            )
          })}
        </section>
      )}
      {pluginProfiles.map((profile) => {
        const entries = rows?.filter((row) => row.profile === profile)
        return entries?.length ? (
          <section key={profile}>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              {t(scopes[profile])}
              <Badge variant="outline">{entries.length}</Badge>
            </h3>
            <div className="divide-y rounded-lg border px-3">
              {entries.map((row) => (
                <div key={row.id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{pluginTitle(row, language)}</div>
                    <div className="break-all text-xs text-muted-foreground">
                      {row.owner ?? row.name}
                    </div>
                  </div>
                  {row.protected ? <Badge variant="secondary">{t('系统必需')}</Badge> : null}
                  {(row.profile === 'client' ? clientStates.get(row.id) : row.state) ===
                    'active' && <Badge variant="outline">{t('已加载')}</Badge>}
                  {!row.protected && row.name !== 'eli.dsh-tree' && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={busy}
                      aria-label={t('编辑插件配置') + ' ' + row.id}
                      onClick={() =>
                        setEditor({
                          profile,
                          id: row.id,
                          text: JSON.stringify(row.config ?? {}, null, 2)
                        })
                      }
                    >
                      <Settings2Icon />
                    </Button>
                  )}
                  <Switch
                    aria-label={t(scopes[profile]) + ' · ' + row.id}
                    checked={!row.disabled}
                    disabled={busy || row.protected}
                    onCheckedChange={(enabled) =>
                      void change({ kind: 'toggle', profile, id: row.id, enabled })
                    }
                  />
                </div>
              ))}
            </div>
          </section>
        ) : null
      })}
      {data && !rows?.length && !packages?.length && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t('没有匹配的插件')}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      )}
      <Dialog
        open={!!editor}
        onOpenChange={(open) => {
          if (!open && !busy) setEditor(undefined)
        }}
      >
        <DialogContent>
          <DialogTitle>{t('编辑插件配置')}</DialogTitle>
          <DialogDescription>
            {editor?.id} · {editor && t(scopes[editor.profile])}
          </DialogDescription>
          <Field data-invalid={!!editor?.error}>
            <FieldLabel htmlFor="plugin-config">JSON</FieldLabel>
            <Textarea
              id="plugin-config"
              disabled={busy}
              rows={9}
              aria-invalid={!!editor?.error}
              value={editor?.text ?? ''}
              onChange={(event) =>
                editor && setEditor({ ...editor, text: event.target.value, error: undefined })
              }
            />
          </Field>
          {editor?.error && (
            <Alert variant="destructive">
              <AlertDescription>{editor.error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                if (editor)
                  void change({
                    kind: 'configure',
                    profile: editor.profile,
                    id: editor.id,
                    config: null
                  })
              }}
            >
              {t('恢复默认配置')}
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                if (!editor) return
                try {
                  const config: unknown = JSON.parse(editor.text)
                  if (!config || Array.isArray(config) || typeof config !== 'object')
                    throw new Error(t('插件配置必须是 JSON 对象'))
                  void change({
                    kind: 'configure',
                    profile: editor.profile,
                    id: editor.id,
                    config: config as Record<string, unknown>
                  })
                } catch (cause) {
                  setEditor({ ...editor, error: String(cause) })
                }
              }}
            >
              {t('保存')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!confirmation}
        onOpenChange={(open) => {
          if (!open) setConfirmation(undefined)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('卸载插件')}</AlertDialogTitle>
            <AlertDialogDescription className="break-all">
              {confirmation?.name}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('取消')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => {
                if (confirmation) void change(confirmation)
              }}
            >
              {t('确认')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
