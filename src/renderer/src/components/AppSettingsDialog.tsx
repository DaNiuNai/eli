import { useState, useSyncExternalStore, type ComponentProps } from 'react'
import { Tabs as TabsPrimitive } from '@base-ui/react/tabs'
import {
  BrainCircuitIcon,
  BoxesIcon,
  GlobeIcon,
  SearchIcon,
  Settings2Icon,
  SlidersHorizontalIcon,
  TerminalIcon,
  XIcon
} from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle
} from '@renderer/components/ui/dialog'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel
} from '@renderer/components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@renderer/components/ui/input-group'
import { TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group'
import { useLanguage } from '@renderer/hooks/use-language'
import { isTheme, useTheme } from '@renderer/hooks/use-theme'
import { getAppPreferences, subscribeAppPreferences } from '@renderer/lib/app-preferences'
import { AgentSettingsPanel } from './AgentSettingsPanel'
import { AgentLoginDialog } from './AgentLoginDialog'
import { TerminalSetupDialog } from './TerminalSetupDialog'

const categories = [
  { value: 'general', label: '通用', icon: Settings2Icon },
  { value: 'models', label: '模型与思考', icon: BrainCircuitIcon },
  { value: 'context', label: '上下文压缩', icon: SlidersHorizontalIcon },
  { value: 'network', label: '网络与重试', icon: GlobeIcon },
  { value: 'tools', label: '工具与 Shell', icon: TerminalIcon },
  { value: 'resources', label: '资源与技能', icon: BoxesIcon }
] as const

const themeOptions = [
  { value: 'light', label: '亮色' },
  { value: 'dark', label: '暗色' },
  { value: 'system', label: '跟随系统' }
]

function GeneralSettings({ onOpenLogin }: { onOpenLogin: () => void }): React.JSX.Element {
  const { t } = useLanguage()
  const { theme, setTheme } = useTheme()
  const { terminal } = useSyncExternalStore(subscribeAppPreferences, getAppPreferences)
  const [terminalOpen, setTerminalOpen] = useState(false)
  return (
    <>
      <section className="flex flex-col gap-6">
        <h3 className="text-sm font-semibold">{t('外观')}</h3>
        <FieldGroup className="gap-0">
          <Field orientation="responsive" className="settings-row">
            <FieldContent>
              <FieldLabel id="settings-theme-label">{t('外观')}</FieldLabel>
              <FieldDescription>{t('选择 eli 的界面主题。')}</FieldDescription>
            </FieldContent>
            <ToggleGroup
              value={[theme]}
              onValueChange={(values) => isTheme(values[0]) && setTheme(values[0])}
              aria-labelledby="settings-theme-label"
              variant="outline"
              size="sm"
              spacing={0}
            >
              {themeOptions.map(({ value, label }) => (
                <ToggleGroupItem key={value} value={value}>
                  {t(label)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>
        </FieldGroup>
      </section>
      <section className="flex flex-col gap-6">
        <h3 className="text-sm font-semibold">{t('账号与登录')}</h3>
        <FieldGroup className="gap-0">
          <Field orientation="responsive" className="settings-row">
            <FieldContent className="min-w-0">
              <FieldLabel htmlFor="settings-login">{t('登录服务')}</FieldLabel>
              <FieldDescription>
                {t('使用账号或 API 密钥登录，凭据仅保存在 ~/.eli。')}
              </FieldDescription>
            </FieldContent>
            <Button id="settings-login" variant="outline" size="sm" onClick={onOpenLogin}>
              {t('登录')}
            </Button>
          </Field>
        </FieldGroup>
      </section>
      <section className="flex flex-col gap-6">
        <h3 className="text-sm font-semibold">{t('终端')}</h3>
        <FieldGroup className="gap-0">
          <Field orientation="responsive" className="settings-row">
            <FieldContent className="min-w-0">
              <FieldLabel htmlFor="settings-terminal">{t('命令执行终端')}</FieldLabel>
              <FieldDescription className="break-all">
                {terminal?.path ?? t('使用系统默认终端')}
              </FieldDescription>
              <FieldDescription>
                {t('仅对 eli 生效，保存后用于后续请求，当前任务继续运行。')}
              </FieldDescription>
            </FieldContent>
            <Button
              id="settings-terminal"
              variant="outline"
              size="sm"
              onClick={() => setTerminalOpen(true)}
            >
              {t('更改终端')}
            </Button>
          </Field>
        </FieldGroup>
      </section>
      {terminalOpen && (
        <TerminalSetupDialog
          onComplete={() => setTerminalOpen(false)}
          onCancel={() => setTerminalOpen(false)}
        />
      )}
    </>
  )
}

export function AppSettingsDialog({
  open,
  onOpenChange,
  login
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  login: ComponentProps<typeof AgentLoginDialog>
}): React.JSX.Element {
  const { t } = useLanguage()
  const [category, setCategory] = useState<(typeof categories)[number]['value']>('general')
  const [query, setQuery] = useState('')
  const activeCategory = category
  const visibleCategories = categories
  const selected = categories.find(({ value }) => value === activeCategory) ?? categories[0]
  const showGeneral = [
    '通用',
    '外观',
    '主题',
    '登录',
    '账号',
    'API 密钥',
    '终端',
    'general',
    'theme',
    'appearance',
    'login',
    'account',
    'api key',
    'terminal',
    'shell',
    'powershell',
    'bash',
    'zsh'
  ].some(
    (word) =>
      t(word).toLowerCase().includes(query.trim().toLowerCase()) || word.includes(query.trim())
  )
  const title = query.trim() ? t('搜索设置') : t(selected.label)

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) setQuery('')
        onOpenChange(value)
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="app-settings-dialog h-[min(820px,90dvh)] w-[min(1120px,94vw)] max-w-none overflow-hidden p-0 sm:max-w-none"
      >
        <DialogTitle className="sr-only">{t('设置')}</DialogTitle>
        <DialogDescription className="sr-only">
          {t('管理 eli 界面与 Agent 设置。')}
        </DialogDescription>
        {/* 生成的 Tabs 封装未转发 orientation，在调用处使用原生 Root 保留垂直导航语义。 */}
        <TabsPrimitive.Root
          value={activeCategory}
          onValueChange={(value) => {
            const next = visibleCategories.find((item) => item.value === value)
            if (next) setCategory(next.value)
            setQuery('')
          }}
          orientation="vertical"
          className="group/tabs settings-layout flex min-h-0 flex-1 gap-0"
        >
          <aside className="settings-navigation flex w-52 shrink-0 flex-col gap-7 border-r bg-muted/30 p-3 pt-5">
            <InputGroup className="shrink-0">
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
              <InputGroupInput
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('搜索设置')}
                aria-label={t('搜索设置')}
              />
            </InputGroup>
            <nav className="flex shrink-0 flex-col gap-3" aria-label={t('设置分类')}>
              <span className="px-2 text-xs font-semibold text-muted-foreground">Eli</span>
              <TabsList className="settings-tabs w-full bg-transparent p-0">
                {visibleCategories.map(({ value, label, icon: Icon }) => (
                  <TabsTrigger key={value} value={value} className="settings-tab gap-2.5 px-2.5">
                    <Icon />
                    {t(label)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </nav>
            <p className="mt-auto px-2 pb-2 text-xs text-muted-foreground">
              {t('配置与数据保存在 ~/.eli')}
            </p>
          </aside>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <header className="flex shrink-0 flex-col gap-2 px-8 pb-5 pr-14 pt-8">
              <h2 className="text-lg font-semibold">{title}</h2>
              <p className="text-sm text-muted-foreground">
                {t(
                  query.trim()
                    ? '搜索 Eli 设置。'
                    : activeCategory === 'general'
                      ? '让 eli 更符合你的使用习惯。'
                      : '管理 eli Agent Runtime 的配置。'
                )}
              </p>
            </header>
            <TabsContent value={activeCategory} className="flex min-h-0 flex-1 flex-col">
              {open ? (
                <AgentSettingsPanel
                  enabled
                  category={activeCategory}
                  query={query}
                  general={
                    (activeCategory === 'general' && !query.trim()) ||
                    (showGeneral && !!query.trim()) ? (
                      <GeneralSettings onOpenLogin={() => login.onOpenChange(true)} />
                    ) : null
                  }
                />
              ) : null}
            </TabsContent>
          </div>
        </TabsPrimitive.Root>
        <DialogClose
          render={<Button variant="ghost" size="icon-sm" className="absolute right-3 top-3" />}
          aria-label={t('关闭')}
        >
          <XIcon />
        </DialogClose>
        {open && <AgentLoginDialog {...login} />}
      </DialogContent>
    </Dialog>
  )
}
