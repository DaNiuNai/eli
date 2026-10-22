import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { DragDropProvider, KeyboardSensor, PointerSensor } from '@dnd-kit/react'
import { isSortable } from '@dnd-kit/react/sortable'
import { Accessibility, PointerActivationConstraints } from '@dnd-kit/dom'
import {
  ArchiveIcon,
  ChevronRightIcon,
  Code2Icon,
  EllipsisIcon,
  MessageCircleQuestionIcon,
  PlusIcon,
  SearchIcon,
  ShieldQuestionIcon
} from 'lucide-react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@renderer/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@renderer/components/ui/input-group'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar
} from '@renderer/components/ui/sidebar'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { Spinner } from '@renderer/components/ui/spinner'
import { DeleteSessionAction } from '@renderer/components/DeleteSessionAction'
import { SortableSidebarItem } from '@renderer/components/SortableSidebarItem'
import { directoryName } from '@renderer/lib/pi-display'
import { useLanguage } from '@renderer/hooks/use-language'
import { getAppPreferences, subscribeAppPreferences } from '@renderer/lib/app-preferences'
import { archiveWorkspace, workspacePathKey } from '@renderer/lib/workspace-archive'
import {
  orderSidebarItems,
  reorderSidebarSessions,
  reorderSidebarWorkspaces
} from '@renderer/lib/sidebar-order'
import type { PiSnapshot } from '../../../shared/pi'
import type { PiLibrary, SavedSession } from '../../../shared/pi-library'

const dragSensors = [
  PointerSensor.configure({
    activationConstraints: [new PointerActivationConstraints.Distance({ value: 6 })]
  }),
  KeyboardSensor
]
function moveItem(items: string[], from: number, to: number): string[] {
  const next = [...items]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

function WorkspaceCollapsible({
  initiallyOpen,
  unavailable,
  children
}: {
  initiallyOpen: boolean
  unavailable: boolean
  children: ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(initiallyOpen)
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      data-unavailable={unavailable || undefined}
      className="group/workspace mb-2 data-[unavailable]:opacity-50"
    >
      {children}
    </Collapsible>
  )
}

interface PiSidebarProps {
  snapshot: PiSnapshot | null
  library: PiLibrary | null
  loading: boolean
  onNewSession: (cwd?: string) => void
  onOpenSession: (session: SavedSession) => void
  onDeleteSession: (session: SavedSession) => Promise<void>
}

export function PiSidebar({
  snapshot,
  library,
  loading,
  onNewSession,
  onOpenSession,
  onDeleteSession
}: PiSidebarProps): React.JSX.Element {
  const { t, locale, language } = useLanguage()
  const dragAccessibility = useMemo(
    () =>
      Accessibility.configure({
        screenReaderInstructions: {
          draggable: t('按空格键开始拖动，使用上下方向键调整位置，再按空格键完成，按 Esc 取消。')
        },
        announcements: {
          dragstart: () => t('已开始拖动，可使用上下方向键调整顺序。'),
          dragover: () => t('正在调整顺序。'),
          dragend: ({ canceled }) => t(canceled ? '已取消拖动。' : '顺序已保存。')
        }
      }),
    [t]
  )
  const [search, setSearch] = useState('')
  const { sidebarOrder: order, archivedWorkspaces } = useSyncExternalStore(
    subscribeAppPreferences,
    getAppPreferences
  )
  const { isMobile, setOpenMobile } = useSidebar()
  const ready = !!snapshot?.sessionKey
  const unavailableWorkspaces = new Set(snapshot?.unavailableWorkspaces)
  const archived = new Set(archivedWorkspaces.map(workspacePathKey))
  const groups = new Map<string, SavedSession[]>()
  const query = search.trim().toLocaleLowerCase()
  const sessionsByPath = new Map(
    (library?.sessions ?? []).map((session) => [session.path, session])
  )
  for (const session of snapshot?.liveSessions ?? []) sessionsByPath.set(session.path, session)
  for (const session of [...sessionsByPath.values()].sort((a, b) => b.created - a.created)) {
    if (archived.has(workspacePathKey(session.cwd))) continue
    if (query && !`${session.title} ${session.cwd}`.toLocaleLowerCase().includes(query)) continue
    const list = groups.get(session.cwd) ?? []
    list.push(session)
    groups.set(session.cwd, list)
  }
  if (snapshot?.cwd && !archived.has(workspacePathKey(snapshot.cwd)) && !groups.has(snapshot.cwd)) {
    groups.set(snapshot.cwd, [])
  }
  const orderedGroups = orderSidebarItems([...groups], order.workspaces, ([cwd]) => cwd).map(
    ([cwd, sessions]): [string, SavedSession[]] => [
      cwd,
      orderSidebarItems(
        sessions,
        [
          ...sessions
            .filter((session) => !order.sessions[cwd]?.includes(session.path))
            .map((session) => session.path),
          ...(order.sessions[cwd] ?? [])
        ],
        (session) => session.path
      )
    ]
  )
  const dragDisabled = !ready || loading || !!query

  function navigate(action: () => void): void {
    action()
    if (isMobile) setOpenMobile(false)
  }

  return (
    <Sidebar
      collapsible={isMobile ? 'offcanvas' : 'none'}
      className="desktop-sidebar w-full"
      aria-label={t('工作目录与历史会话')}
    >
      <SidebarHeader className="desktop-sidebar-header gap-3 px-3 pb-2 pt-3">
        <div className="flex h-9 items-center gap-2 rounded-lg bg-sidebar-accent px-3 text-sm">
          <Code2Icon className="size-4" />
          <span className="font-medium">Code</span>
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              disabled={!ready || unavailableWorkspaces.has(snapshot?.cwd ?? '')}
              onClick={() => navigate(() => onNewSession())}
            >
              <PlusIcon />
              <span>{t('新对话')}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent className="gap-1 px-1">
        <SidebarGroup className="gap-3">
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              aria-label={t('搜索历史会话')}
              placeholder={t('搜索对话…')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </InputGroup>
          <SidebarGroupContent>
            {loading && !library ? (
              <div className="flex flex-col gap-3 px-2 py-3">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-2/3" />
              </div>
            ) : (
              <DragDropProvider
                key={language}
                sensors={dragSensors}
                plugins={(defaults) =>
                  defaults.map((plugin) => (plugin === Accessibility ? dragAccessibility : plugin))
                }
                onDragEnd={(event) => {
                  if (event.canceled) return
                  const { source } = event.operation
                  if (!isSortable(source) || source.group !== source.initialGroup) return
                  const { initialIndex, index, initialGroup } = source
                  if (initialIndex === index) return
                  if (initialGroup === 'workspaces') {
                    reorderSidebarWorkspaces(
                      moveItem(
                        orderedGroups.map(([cwd]) => cwd),
                        initialIndex,
                        index
                      )
                    )
                  } else if (
                    typeof initialGroup === 'string' &&
                    initialGroup.startsWith('session:')
                  ) {
                    const cwd = initialGroup.slice('session:'.length)
                    const sessions = orderedGroups.find(([path]) => path === cwd)?.[1]
                    if (sessions) {
                      reorderSidebarSessions(
                        cwd,
                        moveItem(
                          sessions.map((session) => session.path),
                          initialIndex,
                          index
                        )
                      )
                    }
                  }
                }}
              >
                <SidebarMenu>
                  {orderedGroups.map(([cwd, sessions], workspaceIndex) => (
                    <SortableSidebarItem
                      key={`${cwd}:${query}`}
                      id={`workspace:${cwd}`}
                      index={workspaceIndex}
                      group="workspaces"
                      disabled={dragDisabled}
                    >
                      {(workspaceHandleRef) => (
                        <WorkspaceCollapsible
                          initiallyOpen={!!query || cwd === snapshot?.cwd}
                          unavailable={unavailableWorkspaces.has(cwd)}
                        >
                          <div className="group/workspace-header relative">
                            <CollapsibleTrigger
                              ref={workspaceHandleRef}
                              render={<SidebarMenuButton className="sidebar-drag-handle pr-14!" />}
                              title={`${cwd || t('未记录工作目录')}\n${t(unavailableWorkspaces.has(cwd) ? '工作目录不存在或无法访问' : '拖动调整目录顺序')}`}
                            >
                              <ChevronRightIcon className="transition-transform group-data-open/workspace:rotate-90" />
                              <span>{directoryName(cwd, t('工作目录'))}</span>
                            </CollapsibleTrigger>
                            {!!cwd && (
                              <>
                                <DropdownMenu>
                                  <DropdownMenuTrigger
                                    render={
                                      <SidebarMenuAction className="right-7 opacity-0 group-hover/workspace-header:opacity-100 group-focus-within/workspace-header:opacity-100 aria-expanded:opacity-100" />
                                    }
                                    aria-label={t('工作目录选项：{directory}', {
                                      directory: directoryName(cwd)
                                    })}
                                    title={t('更多选项')}
                                  >
                                    <EllipsisIcon />
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="w-40">
                                    <DropdownMenuGroup>
                                      <DropdownMenuItem onClick={() => archiveWorkspace(cwd)}>
                                        <ArchiveIcon />
                                        {t('归档')}
                                      </DropdownMenuItem>
                                    </DropdownMenuGroup>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                                <SidebarMenuAction
                                  className="opacity-0 group-hover/workspace-header:opacity-100 group-focus-within/workspace-header:opacity-100"
                                  aria-label={t('在 {directory} 中新建对话', {
                                    directory: directoryName(cwd)
                                  })}
                                  title={t('新建对话')}
                                  disabled={!ready || unavailableWorkspaces.has(cwd)}
                                  onClick={() => navigate(() => onNewSession(cwd))}
                                >
                                  <PlusIcon />
                                </SidebarMenuAction>
                              </>
                            )}
                          </div>
                          <CollapsibleContent>
                            <SidebarMenu className="mt-1 pl-3">
                              {sessions.map((session, sessionIndex) => (
                                <SortableSidebarItem
                                  key={session.path}
                                  id={`session:${session.path}`}
                                  index={sessionIndex}
                                  group={`session:${cwd}`}
                                  disabled={dragDisabled}
                                  className="group/session"
                                >
                                  {(sessionHandleRef) => (
                                    <>
                                      <SidebarMenuButton
                                        ref={sessionHandleRef}
                                        className="sidebar-drag-handle"
                                        isActive={
                                          session.path === snapshot?.session?.sessionFile ||
                                          session.path === snapshot?.sessionKey
                                        }
                                        disabled={!ready}
                                        title={`${session.title}\n${new Date(session.modified).toLocaleString(locale)}\n${t('拖动调整会话顺序')}`}
                                        onClick={() => navigate(() => onOpenSession(session))}
                                      >
                                        {snapshot?.liveSessions.some(
                                          (entry) =>
                                            entry.path === session.path && entry.questionCount > 0
                                        ) ? (
                                          <MessageCircleQuestionIcon
                                            aria-label={t('等待你的回答')}
                                          />
                                        ) : snapshot?.liveSessions.some(
                                            (entry) =>
                                              entry.path === session.path && entry.approvalCount > 0
                                          ) ? (
                                          <ShieldQuestionIcon aria-label={t('等待工具审批')} />
                                        ) : snapshot?.liveSessions.some(
                                            (entry) =>
                                              entry.path === session.path &&
                                              (entry.running || entry.pending)
                                          ) ? (
                                          <Spinner aria-label={t('正在处理')} />
                                        ) : (
                                          <span aria-hidden="true" className="size-4 shrink-0" />
                                        )}
                                        <span>{session.title}</span>
                                      </SidebarMenuButton>
                                      <DeleteSessionAction
                                        session={session}
                                        disabled={
                                          !ready ||
                                          !!snapshot?.liveSessions.some(
                                            (entry) =>
                                              entry.path === session.path &&
                                              (entry.running || entry.pending)
                                          )
                                        }
                                        onDelete={onDeleteSession}
                                      />
                                    </>
                                  )}
                                </SortableSidebarItem>
                              ))}
                              {sessions.length === 0 && (
                                <li className="px-2 py-2 text-xs text-muted-foreground">
                                  {t(query ? '没有匹配的对话' : '还没有保存的对话')}
                                </li>
                              )}
                            </SidebarMenu>
                          </CollapsibleContent>
                        </WorkspaceCollapsible>
                      )}
                    </SortableSidebarItem>
                  ))}
                  {groups.size === 0 && (
                    <li className="px-2 py-3 text-xs text-muted-foreground">
                      {t(
                        query
                          ? '没有匹配的对话'
                          : archived.size > 0
                            ? '已归档的工作目录可通过重新选择目录恢复显示。'
                            : '对话开始后会显示在这里'
                      )}
                    </li>
                  )}
                </SidebarMenu>
              </DragDropProvider>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}
