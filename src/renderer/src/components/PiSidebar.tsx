import { useState } from 'react'
import {
  ChartNoAxesCombinedIcon,
  ChevronRightIcon,
  Code2Icon,
  FolderOpenIcon,
  LaptopIcon,
  MessageCircleIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon
} from 'lucide-react'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@renderer/components/ui/collapsible'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@renderer/components/ui/input-group'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
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
import { ModeToggle } from '@renderer/components/ModeToggle'
import { directoryName } from '@renderer/lib/pi-display'
import type { PiSnapshot } from '../../../shared/pi'
import type { PiLibrary, SavedSession } from '../../../shared/pi-library'

interface PiSidebarProps {
  snapshot: PiSnapshot | null
  library: PiLibrary | null
  loading: boolean
  overview: boolean
  busy: boolean
  onOverview: () => void
  onNewSession: (cwd?: string) => void
  onOpenSession: (session: SavedSession) => void
  onChooseDirectory: () => void
  onRefresh: () => void
  onReconnect: () => void
}

export function PiSidebar({
  snapshot,
  library,
  loading,
  overview,
  busy,
  onOverview,
  onNewSession,
  onOpenSession,
  onChooseDirectory,
  onRefresh,
  onReconnect
}: PiSidebarProps): React.JSX.Element {
  const [search, setSearch] = useState('')
  const { isMobile, setOpenMobile } = useSidebar()
  const ready = snapshot?.connection === 'ready'
  const groups = new Map<string, SavedSession[]>()
  if (snapshot?.cwd) groups.set(snapshot.cwd, [])
  const query = search.trim().toLocaleLowerCase()
  for (const session of library?.sessions ?? []) {
    if (query && !`${session.title} ${session.cwd}`.toLocaleLowerCase().includes(query)) continue
    const list = groups.get(session.cwd) ?? []
    list.push(session)
    groups.set(session.cwd, list)
  }

  function navigate(action: () => void): void {
    action()
    if (isMobile) setOpenMobile(false)
  }

  return (
    <Sidebar className="desktop-sidebar" aria-label="工作目录与历史会话">
      <SidebarHeader className="gap-3 px-3 pb-2 pt-4">
        <div className="flex h-9 items-center gap-2 rounded-lg bg-sidebar-accent px-3 text-sm">
          <Code2Icon className="size-4" />
          <span className="font-medium">Code</span>
          <span className="ml-auto text-xs text-muted-foreground">pi</span>
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              disabled={!ready || busy}
              onClick={() => navigate(() => onNewSession())}
            >
              <PlusIcon />
              <span>新对话</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton isActive={overview} onClick={() => navigate(onOverview)}>
              <ChartNoAxesCombinedIcon />
              <span>用量概览</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton disabled={busy || !ready} onClick={onChooseDirectory}>
              <FolderOpenIcon />
              <span>打开工作目录</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent className="gap-1 px-1">
        <SidebarGroup className="gap-3">
          <div className="flex items-center justify-between pl-2 text-xs text-muted-foreground">
            <span>工作目录</span>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="刷新历史和统计"
              title="刷新历史和统计"
              disabled={loading}
              onClick={onRefresh}
            >
              <RefreshCwIcon />
            </Button>
          </div>
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              aria-label="搜索历史会话"
              placeholder="搜索对话…"
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
              <SidebarMenu>
                {[...groups].map(([cwd, sessions]) => (
                  <SidebarMenuItem key={`${cwd}:${query}`}>
                    <Collapsible
                      defaultOpen={!!query || cwd === snapshot?.cwd}
                      className="group/workspace mb-2"
                    >
                      <CollapsibleTrigger
                        render={<SidebarMenuButton />}
                        title={cwd || '未记录工作目录'}
                      >
                        <ChevronRightIcon className="transition-transform group-data-open/workspace:rotate-90" />
                        <span>{directoryName(cwd)}</span>
                      </CollapsibleTrigger>
                      {!!cwd && (
                        <SidebarMenuAction
                          aria-label={`在 ${directoryName(cwd)} 中新建对话`}
                          title="新建对话"
                          disabled={!ready || busy}
                          onClick={() => navigate(() => onNewSession(cwd))}
                        >
                          <PlusIcon />
                        </SidebarMenuAction>
                      )}
                      <CollapsibleContent>
                        <SidebarMenu className="mt-1 pl-3">
                          {sessions.map((session) => (
                            <SidebarMenuItem key={session.path}>
                              <SidebarMenuButton
                                isActive={
                                  !overview && session.path === snapshot?.session?.sessionFile
                                }
                                disabled={!ready || busy}
                                title={`${session.title}\n${new Date(session.modified).toLocaleString()}`}
                                onClick={() => navigate(() => onOpenSession(session))}
                              >
                                <MessageCircleIcon />
                                <span>{session.title}</span>
                              </SidebarMenuButton>
                            </SidebarMenuItem>
                          ))}
                          {sessions.length === 0 && (
                            <li className="px-2 py-2 text-xs text-muted-foreground">
                              {query ? '没有匹配的对话' : '还没有保存的对话'}
                            </li>
                          )}
                        </SidebarMenu>
                      </CollapsibleContent>
                    </Collapsible>
                  </SidebarMenuItem>
                ))}
                {groups.size === 0 && (
                  <li className="px-2 py-3 text-xs text-muted-foreground">
                    {query ? '没有匹配的对话' : '对话开始后会显示在这里'}
                  </li>
                )}
              </SidebarMenu>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="gap-3 border-t border-sidebar-border px-4 py-3">
        <div className="flex items-center gap-2">
          <LaptopIcon className="size-4 text-muted-foreground" />
          <span className="text-sm">本机 pi</span>
          <Badge className="ml-auto" variant={ready ? 'secondary' : 'outline'}>
            {ready ? '已连接' : snapshot?.connection === 'error' ? '连接失败' : '连接中'}
          </Badge>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">本地会话 · 自动保存</span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              title="重新连接 pi"
              aria-label="重新连接 pi"
              disabled={busy || snapshot?.connection === 'connecting' || !window.api}
              onClick={onReconnect}
            >
              <RefreshCwIcon />
            </Button>
            <ModeToggle />
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
