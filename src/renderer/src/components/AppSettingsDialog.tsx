import { useState } from 'react'
import { Tabs as TabsPrimitive } from '@base-ui/react/tabs'
import {
  BrainCircuitIcon,
  BookOpenIcon,
  PlugIcon,
  BoxesIcon,
  GlobeIcon,
  InfoIcon,
  SearchIcon,
  Settings2Icon,
  SlidersHorizontalIcon,
  TerminalIcon,
  ServerIcon,
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
import { AgentSettingsPanel } from './AgentSettingsPanel'
import { ProviderAuthDialog } from './ProviderAuthDialog'
import { ProviderSettingsPanel } from './ProviderSettingsPanel'
import type { useAgentAuth } from '@renderer/hooks/use-agent-auth'
import { TerminalSettings } from './TerminalSettings'
import { AboutSettings } from './AboutSettings'
import { AutoApprovalSettings } from './AutoApprovalSettings'
import { SkillsSettingsPanel } from './SkillsSettingsPanel'
import { McpSettingsPanel } from './McpSettingsPanel'
import { AutoSaveStatus } from './AutoSaveStatus'

const categories = [
  { value: 'general', label: '通用', icon: Settings2Icon },
  { value: 'providers', label: '模型供应商', icon: PlugIcon },
  { value: 'models', label: '模型与思考', icon: BrainCircuitIcon },
  { value: 'context', label: '上下文压缩', icon: SlidersHorizontalIcon },
  { value: 'network', label: '网络与重试', icon: GlobeIcon },
  { value: 'tools', label: '工具与 Shell', icon: TerminalIcon },
  { value: 'resources', label: '资源与加载', icon: BoxesIcon },
  { value: 'skills', label: 'Skill 管理', icon: BookOpenIcon },
  { value: 'mcp', label: 'MCP 管理', icon: ServerIcon },
  { value: 'about', label: '关于', icon: InfoIcon }
] as const

const themeOptions = [
  { value: 'light', label: '亮色' },
  { value: 'dark', label: '暗色' },
  { value: 'system', label: '跟随系统' }
]

function GeneralSettings(): React.JSX.Element {
  const { t } = useLanguage()
  const { theme, setTheme } = useTheme()
  return (
    <FieldGroup className="gap-0">
      <section className="flex flex-col gap-6">
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
        <TerminalSettings />
      </section>
      <AutoApprovalSettings />
    </FieldGroup>
  )
}

export function AppSettingsDialog({
  open,
  onOpenChange,
  login
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  login: ReturnType<typeof useAgentAuth>
}): React.JSX.Element {
  const { t } = useLanguage()
  const [category, setCategory] = useState<(typeof categories)[number]['value']>(
    login.open ? 'providers' : 'general'
  )
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
    '自动批准',
    '自动审核',
    '审批',
    '审核模型',
    'auto approval',
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
  const showAbout = [
    '关于',
    '软件更新',
    '检查更新',
    '版本',
    '下载',
    'about',
    'update',
    'version',
    'download',
    'github'
  ].some(
    (word) =>
      t(word).toLowerCase().includes(query.trim().toLowerCase()) || word.includes(query.trim())
  )
  const includeGeneral =
    (activeCategory === 'general' && !query.trim()) || (showGeneral && !!query.trim())
  const includeAbout = showAbout && !!query.trim()
  const includeSkills =
    !!query.trim() &&
    ['Skill 管理', '用户级 Skill', '技能', 'skills', t('Skill 管理'), t('用户级 Skill')].some(
      (word) => word.toLowerCase().includes(query.trim().toLowerCase())
    )
  const includeMcp =
    !!query.trim() &&
    ['MCP 管理', 'MCP 服务', 'stdio', 'HTTP', t('MCP 管理')].some((word) =>
      word.toLowerCase().includes(query.trim().toLowerCase())
    )

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
              <span className="px-2 text-xs font-semibold text-muted-foreground">{t('配置')}</span>
              <TabsList className="settings-tabs w-full bg-transparent p-0">
                {visibleCategories.map(({ value, label, icon: Icon }) => (
                  <TabsTrigger key={value} value={value} className="settings-tab gap-2.5 px-2.5">
                    <Icon />
                    {t(label)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </nav>
            <div className="mt-auto shrink-0 px-2 pb-2">
              <AutoSaveStatus />
            </div>
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
                      : activeCategory === 'about'
                        ? '查看 eli 版本与软件更新。'
                        : activeCategory === 'skills'
                          ? '查看和管理用户级 Skill。'
                          : activeCategory === 'mcp'
                            ? '配置 MCP 服务并查看可用工具。'
                            : '管理 eli Agent Runtime 的配置。'
                )}
              </p>
            </header>
            <TabsContent value={activeCategory} className="flex min-h-0 flex-1 flex-col">
              {open && activeCategory === 'providers' && !query.trim() ? (
                <ProviderSettingsPanel auth={login} />
              ) : open && activeCategory === 'about' && !query.trim() ? (
                <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
                  <AboutSettings />
                </div>
              ) : open && activeCategory === 'skills' && !query.trim() ? (
                <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
                  <SkillsSettingsPanel />
                </div>
              ) : open && activeCategory === 'mcp' && !query.trim() ? (
                <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
                  <McpSettingsPanel />
                </div>
              ) : open ? (
                <AgentSettingsPanel
                  enabled
                  category={
                    activeCategory === 'providers' ||
                    activeCategory === 'about' ||
                    activeCategory === 'mcp' ||
                    activeCategory === 'skills'
                      ? 'general'
                      : activeCategory
                  }
                  query={query}
                  general={
                    includeGeneral || includeAbout || includeSkills || includeMcp ? (
                      <div className="flex flex-col gap-8">
                        {includeGeneral && <GeneralSettings />}
                        {includeAbout && <AboutSettings />}
                        {includeSkills && <SkillsSettingsPanel />}
                        {includeMcp && <McpSettingsPanel />}
                      </div>
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
        {open && <ProviderAuthDialog snapshot={login.snapshot} perform={login.perform} />}
      </DialogContent>
    </Dialog>
  )
}
