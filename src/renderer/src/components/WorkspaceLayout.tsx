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
import { sidebarSizing, tasksPanelSizing } from '../../../shared/app-preferences'

export function WorkspaceLayout({
  sidebar,
  tasksPanel,
  tasksOpen,
  onTasksOpenChange,
  children
}: {
  sidebar: ReactNode
  tasksPanel: ReactNode
  tasksOpen: boolean
  onTasksOpenChange: (open: boolean) => void
  children: ReactNode
}): React.JSX.Element {
  const { t } = useLanguage()
  const { isMobile } = useSidebar()
  const { sidebarOpen, sidebarWidth, tasksPanelWidth } = useSyncExternalStore(
    subscribeAppPreferences,
    getAppPreferences
  )
  const [sidebarPanel, setSidebarPanel] = usePanelCallbackRef()
  const [tasksPanelHandle, setTasksPanelHandle] = usePanelCallbackRef()
  const [initialSidebarSize] = useState(() => (sidebarOpen ? sidebarWidth : 0))
  const [initialTasksSize] = useState(() => (tasksOpen ? tasksPanelWidth : 0))

  useLayoutEffect(() => {
    if (!sidebarPanel || isMobile) return
    if (sidebarOpen) sidebarPanel.resize(sidebarWidth)
    else sidebarPanel.collapse()
  }, [sidebarPanel, isMobile, sidebarOpen, sidebarWidth])

  useLayoutEffect(() => {
    if (!tasksPanelHandle || isMobile) return
    if (tasksOpen) tasksPanelHandle.resize(tasksPanelWidth)
    else tasksPanelHandle.collapse()
  }, [tasksPanelHandle, isMobile, tasksOpen, tasksPanelWidth])

  if (isMobile) {
    return (
      <div className="background-tasks-layout">
        {sidebar}
        {children}
        {tasksOpen && tasksPanel}
      </div>
    )
  }

  return (
    <ResizablePanelGroup
      id="workspace-layout"
      orientation="horizontal"
      className="min-h-0 flex-1"
      onLayoutChanged={(_, { isUserInteraction }) => {
        if (!isUserInteraction || !sidebarPanel || !tasksPanelHandle) return
        const { inPixels } = sidebarPanel.getSize()
        const open = inPixels > 0
        const width = open
          ? Math.min(sidebarSizing.maxWidth, Math.max(sidebarSizing.minWidth, Math.round(inPixels)))
          : sidebarWidth
        const { inPixels: tasksPixels } = tasksPanelHandle.getSize()
        const tasksExpanded = tasksPixels > 0
        const tasksWidth = tasksExpanded
          ? Math.min(
              tasksPanelSizing.maxWidth,
              Math.max(tasksPanelSizing.minWidth, Math.round(tasksPixels))
            )
          : tasksPanelWidth
        if (open !== sidebarOpen || width !== sidebarWidth || tasksWidth !== tasksPanelWidth) {
          updateAppPreferences({
            sidebarOpen: open,
            sidebarWidth: width,
            tasksPanelWidth: tasksWidth
          })
        }
        if (tasksExpanded !== tasksOpen) onTasksOpenChange(tasksExpanded)
      }}
    >
      <ResizablePanel
        id="workspace-sidebar"
        panelRef={setSidebarPanel}
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
      <ResizableHandle
        className="desktop-sidebar-resize"
        disableDoubleClick
        aria-label={t('调整任务面板宽度')}
        title={t('拖动调整任务面板宽度，双击恢复默认')}
        onDoubleClick={() => {
          updateAppPreferences({ tasksPanelWidth: tasksPanelSizing.defaultWidth })
          onTasksOpenChange(true)
        }}
      />
      <ResizablePanel
        id="workspace-tasks"
        panelRef={setTasksPanelHandle}
        defaultSize={initialTasksSize}
        minSize={tasksPanelSizing.minWidth}
        maxSize={tasksPanelSizing.maxWidth}
        collapsible
        collapsedSize={0}
        groupResizeBehavior="preserve-pixel-size"
        aria-hidden={!tasksOpen}
        inert={!tasksOpen}
        className="h-full min-w-0"
        style={{ overflow: 'hidden' }}
      >
        {tasksPanel}
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
