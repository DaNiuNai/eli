import { useState, useSyncExternalStore } from 'react'
import { Tabs as TabsPrimitive } from '@base-ui/react/tabs'
import { SearchIcon, XIcon } from 'lucide-react'
import { Button } from './ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import { InputGroup, InputGroupAddon, InputGroupInput } from './ui/input-group'
import { TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { AutoSaveStatus } from './AutoSaveStatus'
import { useLanguage } from '../hooks/use-language'
import type { useAgentAuth } from '../hooks/use-agent-auth'
import type { UsageSettingsPanelProps } from './UsageSettingsPanel'
import { usePluginRegistry } from '../plugins/context'
import { PluginSlot } from '../plugins/slots'

export function AppSettingsDialog({
  open,
  onOpenChange,
  login,
  usage
}: {
  open: boolean
  onOpenChange(open: boolean): void
  login: ReturnType<typeof useAgentAuth>
  usage: UsageSettingsPanelProps
}): React.JSX.Element {
  const { t } = useLanguage()
  const registry = usePluginRegistry()
  const pages = useSyncExternalStore(registry.subscribe, registry.settings)
  const [category, setCategory] = useState(login.open ? 'providers' : 'general')
  const [query, setQuery] = useState('')
  const selected = pages.find(({ id }) => id === category) ?? pages[0]
  const activeCategory = selected?.id ?? ''
  const normalized = query.trim().toLowerCase()
  const results = normalized
    ? pages.filter(
        (page) =>
          page.search ||
          page.keywords?.some(
            (word) =>
              word.toLowerCase().includes(normalized) || t(word).toLowerCase().includes(normalized)
          )
      )
    : []
  const pageProps = { query, login, usage, close: () => onOpenChange(false) }
  const Selected = selected?.component
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
        <TabsPrimitive.Root
          value={activeCategory}
          onValueChange={(value) => {
            if (pages.some(({ id }) => id === value)) setCategory(String(value))
            setQuery('')
          }}
          orientation="vertical"
          className="settings-layout flex min-h-0 flex-1 gap-0"
        >
          <aside
            data-orientation="vertical"
            className="group/tabs settings-navigation flex w-52 shrink-0 flex-col gap-7 overflow-y-auto border-r bg-muted/30 p-3 pt-5"
          >
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
                {pages.map(({ id, label, icon: Icon }) => (
                  <TabsTrigger key={id} value={id} className="settings-tab gap-2.5 px-2.5">
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
              <h2 className="text-lg font-semibold">
                {t(normalized ? '搜索设置' : (selected?.label ?? '设置'))}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t(
                  normalized
                    ? '搜索 Eli 设置。'
                    : (selected?.description ?? '管理 eli 界面与 Agent 设置。')
                )}
              </p>
            </header>
            <TabsContent value={activeCategory} className="flex min-h-0 flex-1 flex-col">
              {open &&
                (normalized ? (
                  <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto">
                    {results.map(({ id, component: Page }) => (
                      <section key={id}>
                        <Page {...pageProps} />
                      </section>
                    ))}
                  </div>
                ) : Selected ? (
                  <Selected {...pageProps} />
                ) : null)}
            </TabsContent>
          </div>
        </TabsPrimitive.Root>
        <DialogClose
          render={<Button variant="ghost" size="icon-sm" className="absolute right-3 top-3" />}
          aria-label={t('关闭')}
        >
          <XIcon />
        </DialogClose>
        {open && (
          <PluginSlot name="settings.auth" snapshot={login.snapshot} perform={login.perform} />
        )}
      </DialogContent>
    </Dialog>
  )
}
