import { SidebarTrigger, useSidebar } from '@renderer/components/ui/sidebar'
import { PanelRightIcon } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { AppMenu } from '@renderer/components/AppMenu'
import { useLanguage } from '@renderer/hooks/use-language'
import { updateAppPreferences } from '@renderer/lib/app-preferences'
import { cn } from '@renderer/lib/utils'
import type { AgentSnapshot } from '../../../shared/agent'
import { sidebarSizing, tasksPanelSizing } from '../../../shared/app-preferences'

export function AppTitlebar({
  title,
  snapshot,
  busy,
  tasksOpen,
  onTasksOpenChange,
  onNewSession,
  onChooseDirectory,
  onReconnect,
  onOpenSettings
}: {
  title: string | null
  snapshot: AgentSnapshot | null
  busy: boolean
  tasksOpen: boolean
  onTasksOpenChange: (open: boolean) => void
  onNewSession: () => void
  onChooseDirectory: () => void
  onReconnect: () => void
  onOpenSettings: () => void
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
            onResetLayout={() => {
              updateAppPreferences({
                sidebarOpen: true,
                sidebarWidth: sidebarSizing.defaultWidth,
                tasksPanelWidth: tasksPanelSizing.defaultWidth
              })
              if (isMobile) setOpenMobile(true)
              onTasksOpenChange(true)
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
        <div className="window-titlebar-actions ml-auto flex shrink-0 items-center gap-1">
          <Button
            variant={tasksOpen ? 'secondary' : 'ghost'}
            size="icon-sm"
            aria-label={t('展开或收起任务面板')}
            aria-expanded={tasksOpen}
            aria-controls="background-tasks-sidebar"
            title={t('展开或收起任务面板')}
            onClick={() => onTasksOpenChange(!tasksOpen)}
          >
            <PanelRightIcon />
          </Button>
        </div>
      </div>
    </header>
  )
}
