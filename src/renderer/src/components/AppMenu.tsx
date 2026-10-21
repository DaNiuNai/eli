import { useEffect, useState } from 'react'
import {
  ChevronDownIcon,
  LanguagesIcon,
  LaptopIcon,
  RefreshCwIcon,
  Settings2Icon
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { SidebarMenuButton } from '@renderer/components/ui/sidebar'
import { AppSettingsDialog } from '@renderer/components/AppSettingsDialog'
import { isUiLanguage, useLanguage } from '@renderer/hooks/use-language'
import type { PiSnapshot } from '../../../shared/pi'

export function AppMenu({
  snapshot,
  busy,
  onReconnect
}: {
  snapshot: PiSnapshot | null
  busy: boolean
  onReconnect: () => void
}): React.JSX.Element {
  const { t, language, setLanguage } = useLanguage()
  const [open, setOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const status =
    snapshot?.connection === 'ready'
      ? '已连接'
      : snapshot?.connection === 'error'
        ? '连接失败'
        : '连接中'

  function showSettings(): void {
    setOpen(false)
    setSettingsOpen(true)
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key === ',') {
        event.preventDefault()
        setOpen(false)
        setSettingsOpen(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          render={<SidebarMenuButton size="lg" className="h-10" />}
          aria-label={t('设置与连接')}
        >
          <LaptopIcon />
          <span className="min-w-0 flex-1 truncate">
            {t('本机')} <span className="text-muted-foreground">· {t(status)}</span>
          </span>
          <ChevronDownIcon className="ml-auto" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" sideOffset={8}>
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t('本地会话 · 自动保存')}</DropdownMenuLabel>
            <DropdownMenuItem onClick={showSettings}>
              <Settings2Icon />
              {t('设置')}
              <DropdownMenuShortcut>Ctrl+,</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <LanguagesIcon />
                {t('语言')}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={language}
                  onValueChange={(value) => isUiLanguage(value) && setLanguage(value)}
                >
                  <DropdownMenuRadioItem value="zh-CN">简体中文</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="en">English</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
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
      <AppSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  )
}
