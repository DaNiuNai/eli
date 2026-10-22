import { useEffect, useState } from 'react'
import {
  FolderOpenIcon,
  LanguagesIcon,
  MenuIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  Settings2Icon
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { Button } from '@renderer/components/ui/button'
import { AppLanguageDialog } from '@renderer/components/AppLanguageDialog'
import { useLanguage } from '@renderer/hooks/use-language'
import type { AgentSnapshot } from '../../../shared/agent'

export function AppMenu({
  snapshot,
  busy,
  onNewSession,
  onChooseDirectory,
  onReconnect,
  onOpenSettings,
  onResetLayout
}: {
  snapshot: AgentSnapshot | null
  busy: boolean
  onNewSession: () => void
  onChooseDirectory: () => void
  onReconnect: () => void
  onOpenSettings: () => void
  onResetLayout: () => void
}): React.JSX.Element {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [languageOpen, setLanguageOpen] = useState(false)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key === ',') {
        event.preventDefault()
        setOpen(false)
        onOpenSettings()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onOpenSettings])

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" />}
          aria-label={t('应用菜单')}
          title={t('应用菜单')}
        >
          <MenuIcon data-icon="inline-start" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="start" sideOffset={8} className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuItem
              disabled={
                !snapshot?.sessionKey || snapshot.unavailableWorkspaces.includes(snapshot.cwd)
              }
              onClick={onNewSession}
            >
              <PlusIcon />
              {t('新对话')}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={busy || snapshot?.connection !== 'ready'}
              onClick={onChooseDirectory}
            >
              <FolderOpenIcon />
              {t('选择工作目录')}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              onClick={() => {
                setOpen(false)
                onOpenSettings()
              }}
            >
              <Settings2Icon />
              {t('设置')}
              <DropdownMenuShortcut>Ctrl+,</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setOpen(false)
                setLanguageOpen(true)
              }}
            >
              <LanguagesIcon />
              {t('语言')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onResetLayout}>
              <RotateCcwIcon />
              {t('重置布局')}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              disabled={busy || snapshot?.connection === 'connecting' || !window.api}
              onClick={onReconnect}
            >
              <RefreshCwIcon />
              {t('重新连接')}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <AppLanguageDialog open={languageOpen} onOpenChange={setLanguageOpen} />
    </>
  )
}
