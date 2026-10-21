import { MoonIcon, SunIcon } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { isTheme, useTheme } from '@renderer/hooks/use-theme'
import { useLanguage } from '@renderer/hooks/use-language'

export function ModeToggle(): React.JSX.Element {
  const { theme, setTheme } = useTheme()
  const { t } = useLanguage()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="icon-sm" />}
        aria-label={t('切换主题')}
        title={t('切换主题')}
      >
        <SunIcon className="rotate-0 scale-100 transition-transform dark:-rotate-90 dark:scale-0" />
        <MoonIcon className="absolute rotate-90 scale-0 transition-transform dark:rotate-0 dark:scale-100" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          aria-label={t('主题')}
          value={theme}
          onValueChange={(value) => {
            if (isTheme(value)) setTheme(value)
          }}
        >
          <DropdownMenuRadioItem value="light">{t('亮色')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">{t('暗色')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">{t('跟随系统')}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
