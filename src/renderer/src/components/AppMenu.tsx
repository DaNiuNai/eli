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
import { AppSettingsDialog } from '@renderer/components/AppSettingsDialog'
import { AppLanguageDialog } from '@renderer/components/AppLanguageDialog'
import { useLanguage } from '@renderer/hooks/use-language'
import type { PiSnapshot } from '../../../shared/pi'

export function AppMenu({
  snapshot,
  busy,
  onNewSession,
  onChooseDirectory,
  onReconnect,
  onResetLayout
}: {
  snapshot: PiSnapshot | null
  busy: boolean
  onNewSession: () => void
  onChooseDirectory: () => void
  onReconnect: () => void
  onResetLayout: () => void
}): React.JSX.Element {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [activeDialog, setActiveDialog] = useState<'settings' | 'language' | null>(null)

  function showDialog(dialog: 'settings' | 'language'): void {
    setOpen(false)
    setActiveDialog(dialog)
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key === ',') {
        event.preventDefault()
        setOpen(false)
        setActiveDialog('settings')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

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
            <DropdownMenuItem disabled={!snapshot?.sessionKey} onClick={onNewSession}>
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
            <DropdownMenuItem onClick={() => showDialog('settings')}>
              <Settings2Icon />
              {t('设置')}
              <DropdownMenuShortcut>Ctrl+,</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => showDialog('language')}>
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
      <AppSettingsDialog
        open={activeDialog === 'settings'}
        onOpenChange={(open) => setActiveDialog(open ? 'settings' : null)}
      />
      <AppLanguageDialog
        open={activeDialog === 'language'}
        onOpenChange={(open) => setActiveDialog(open ? 'language' : null)}
      />
    </>
  )
}
