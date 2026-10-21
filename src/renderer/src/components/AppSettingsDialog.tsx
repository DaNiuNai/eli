import { useId } from 'react'
import { XIcon } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@renderer/components/ui/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { useLanguage } from '@renderer/hooks/use-language'
import { isTheme, useTheme } from '@renderer/hooks/use-theme'

const themeLabels = { light: '亮色', dark: '暗色', system: '跟随系统' }

export function AppSettingsDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const { t } = useLanguage()
  const { theme, setTheme } = useTheme()
  const id = useId()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t('设置')}</DialogTitle>
          <DialogDescription>{t('立即应用并在本机保存。')}</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`${id}-theme`}>{t('外观')}</FieldLabel>
            <Select value={theme} onValueChange={(value) => isTheme(value) && setTheme(value)}>
              <SelectTrigger id={`${id}-theme`} className="w-full">
                <SelectValue>{t(themeLabels[theme])}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {Object.entries(themeLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {t(label)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </FieldGroup>
        <DialogClose
          render={<Button variant="ghost" size="icon-sm" className="absolute right-2 top-2" />}
          aria-label={t('关闭')}
        >
          <XIcon />
        </DialogClose>
      </DialogContent>
    </Dialog>
  )
}
