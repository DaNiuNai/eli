import { Fragment, useState } from 'react'
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
import { PiSettingsPanel } from './PiSettingsPanel'

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

function GeneralSettings(): React.JSX.Element {
  const { t } = useLanguage()
  const { theme, setTheme } = useTheme()
  return (
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
  )
}

export function AppSettingsDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const { t } = useLanguage()
  const [category, setCategory] = useState<(typeof categories)[number]['value']>('general')
  const [query, setQuery] = useState('')
  const selected = categories.find(({ value }) => value === category) ?? categories[0]
  const showGeneral = ['通用', '外观', '主题', 'general', 'theme', 'appearance'].some(
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
        <DialogDescription className="sr-only">{t('管理 eli 界面与 PI 设置。')}</DialogDescription>
        {/* 生成的 Tabs 封装未转发 orientation，在调用处使用原生 Root 保留垂直导航语义。 */}
        <TabsPrimitive.Root
          value={category}
          onValueChange={(value) => {
            const next = categories.find((item) => item.value === value)
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
                {categories.map(({ value, label, icon: Icon }) => (
                  <Fragment key={value}>
                    {value === 'models' && (
                      <span className="px-2 pb-2 pt-4 text-xs font-semibold text-muted-foreground">
                        Pi
                      </span>
                    )}
                    <TabsTrigger value={value} className="settings-tab gap-2.5 px-2.5">
                      <Icon />
                      {t(label)}
                    </TabsTrigger>
                  </Fragment>
                ))}
              </TabsList>
            </nav>
          </aside>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <header className="flex shrink-0 flex-col gap-2 px-8 pb-5 pr-14 pt-8">
              <h2 className="text-lg font-semibold">{title}</h2>
              <p className="text-sm text-muted-foreground">
                {t(
                  category === 'general' && !query
                    ? '让 eli 更符合你的使用习惯。'
                    : '管理 PI 在桌面端使用的原生配置。'
                )}
              </p>
            </header>
            <TabsContent value={category} className="flex min-h-0 flex-1 flex-col">
              {open ? (
                <PiSettingsPanel
                  category={category}
                  query={query}
                  general={
                    (category === 'general' && !query.trim()) || (showGeneral && !!query.trim()) ? (
                      <GeneralSettings />
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
      </DialogContent>
    </Dialog>
  )
}
