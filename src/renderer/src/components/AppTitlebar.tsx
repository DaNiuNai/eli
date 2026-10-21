import { SidebarTrigger, useSidebar } from '@renderer/components/ui/sidebar'
import { AppMenu } from '@renderer/components/AppMenu'
import { useLanguage } from '@renderer/hooks/use-language'
import { updateAppPreferences } from '@renderer/lib/app-preferences'
import { cn } from '@renderer/lib/utils'
import type { PiSnapshot } from '../../../shared/pi'
import { sidebarSizing } from '../../../shared/app-preferences'

export function AppTitlebar({
  title,
  snapshot,
  busy,
  onNewSession,
  onChooseDirectory,
  onReconnect,
  onOpenSettings,
  onOpenLogin
}: {
  title: string | null
  snapshot: PiSnapshot | null
  busy: boolean
  onNewSession: () => void
  onChooseDirectory: () => void
  onReconnect: () => void
  onOpenSettings: () => void
  onOpenLogin: () => void
}): React.JSX.Element {
  const { t } = useLanguage()
  const { isMobile, open, openMobile, setOpenMobile } = useSidebar()

  return (
    <header className="desktop-titlebar shrink-0 border-b border-sidebar-border bg-sidebar">
      <div
        className={cn(
          'desktop-titlebar-content flex h-full items-center justify-between gap-3 px-2',
          window.windowAppearance?.customTitleBar && 'window-titlebar'
        )}
      >
        <div className="window-titlebar-actions flex shrink-0 items-center gap-1">
          <AppMenu
            snapshot={snapshot}
            busy={busy}
            onNewSession={onNewSession}
            onChooseDirectory={onChooseDirectory}
            onReconnect={onReconnect}
            onOpenSettings={onOpenSettings}
            onOpenLogin={onOpenLogin}
            onResetLayout={() => {
              updateAppPreferences({
                sidebarOpen: true,
                sidebarWidth: sidebarSizing.defaultWidth
              })
              if (isMobile) setOpenMobile(true)
            }}
          />
          <SidebarTrigger
            className="desktop-sidebar-toggle"
            aria-label={t('展开或收起侧栏')}
            aria-pressed={isMobile ? openMobile : open}
            title={t('展开或收起侧栏 · Ctrl+B')}
          />
        </div>
        {title && (
          <div
            className="desktop-titlebar-title flex h-7 items-center justify-center px-3 text-xs text-muted-foreground"
            title={title}
          >
            <span className="truncate">{title}</span>
          </div>
        )}
      </div>
    </header>
  )
}
