import { CheckIcon, XIcon } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group'
import { isUiLanguage, useLanguage } from '@renderer/hooks/use-language'

const languages = [
  { value: 'zh-CN', nativeName: '简体中文', name: '简体中文' },
  { value: 'en', nativeName: 'English', name: '英语' }
]

export function AppLanguageDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const { t, language, setLanguage } = useLanguage()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="gap-6 p-6 sm:max-w-lg">
        <DialogHeader className="pr-8">
          <DialogTitle>{t('选择语言')}</DialogTitle>
          <DialogDescription className="sr-only">
            {t('选择界面语言。会话内容保持原样。')}
          </DialogDescription>
        </DialogHeader>
        <ToggleGroup
          multiple={false}
          value={[language]}
          onValueChange={([value]) => isUiLanguage(value) && setLanguage(value)}
          aria-label={t('语言')}
          className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2"
        >
          {languages.map(({ value, nativeName, name }) => (
            <ToggleGroupItem
              key={value}
              value={value}
              className="h-auto min-w-0 justify-between gap-3 px-3 py-3"
            >
              <span className="flex min-w-0 flex-col items-start gap-1 text-left">
                <span>{nativeName}</span>
                <span className="text-xs font-normal text-muted-foreground">{t(name)}</span>
              </span>
              <CheckIcon
                data-icon="inline-end"
                aria-hidden="true"
                className="invisible group-aria-pressed/toggle:visible"
              />
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <DialogClose
          render={<Button variant="ghost" size="icon-sm" className="absolute right-4 top-4" />}
          aria-label={t('关闭')}
        >
          <XIcon />
        </DialogClose>
      </DialogContent>
    </Dialog>
  )
}
