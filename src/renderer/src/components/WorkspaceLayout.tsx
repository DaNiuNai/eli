import { useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { usePanelCallbackRef } from 'react-resizable-panels'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
} from '@renderer/components/ui/resizable'
import { useSidebar } from '@renderer/components/ui/sidebar'
import { useLanguage } from '@renderer/hooks/use-language'
import {
  getAppPreferences,
  subscribeAppPreferences,
  updateAppPreferences
} from '@renderer/lib/app-preferences'
import { sidebarSizing } from '../../../shared/app-preferences'

export function WorkspaceLayout({
  sidebar,
  children
}: {
  sidebar: ReactNode
  children: ReactNode
}): React.JSX.Element {
  const { t } = useLanguage()
  const { isMobile } = useSidebar()
  const { sidebarOpen, sidebarWidth } = useSyncExternalStore(
    subscribeAppPreferences,
    getAppPreferences
  )
  const [panel, setPanel] = usePanelCallbackRef()
  const [initialSidebarSize] = useState(() => (sidebarOpen ? sidebarWidth : 0))

  useLayoutEffect(() => {
    if (!panel || isMobile) return
    if (sidebarOpen) panel.resize(sidebarWidth)
    else panel.collapse()
  }, [panel, isMobile, sidebarOpen, sidebarWidth])

  if (isMobile) {
    return (
      <div className="flex min-h-0 flex-1">
        {sidebar}
        {children}
      </div>
    )
  }

  return (
    <ResizablePanelGroup
      id="workspace-layout"
      orientation="horizontal"
      className="min-h-0 flex-1"
      onLayoutChanged={(_, { isUserInteraction }) => {
        if (!isUserInteraction || !panel) return
        const { inPixels } = panel.getSize()
        const open = inPixels > 0
        const width = open
          ? Math.min(sidebarSizing.maxWidth, Math.max(sidebarSizing.minWidth, Math.round(inPixels)))
          : sidebarWidth
        if (open !== sidebarOpen || width !== sidebarWidth) {
          updateAppPreferences({ sidebarOpen: open, sidebarWidth: width })
        }
      }}
    >
      <ResizablePanel
        id="workspace-sidebar"
        panelRef={setPanel}
        defaultSize={initialSidebarSize}
        minSize={sidebarSizing.minWidth}
        maxSize={sidebarSizing.maxWidth}
        collapsible
        collapsedSize={0}
        groupResizeBehavior="preserve-pixel-size"
        aria-hidden={!sidebarOpen}
        inert={!sidebarOpen}
        className="h-full min-w-0"
        style={{ overflow: 'hidden' }}
      >
        {sidebar}
      </ResizablePanel>
      <ResizableHandle
        className="desktop-sidebar-resize"
        disableDoubleClick
        aria-label={t('调整侧栏宽度')}
        title={t('拖动调整侧栏宽度，双击恢复默认')}
        onDoubleClick={() =>
          updateAppPreferences({ sidebarOpen: true, sidebarWidth: sidebarSizing.defaultWidth })
        }
      />
      <ResizablePanel
        id="workspace-chat"
        minSize={360}
        className="flex h-full min-w-0 flex-col"
        style={{ overflow: 'hidden' }}
      >
        {children}
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
