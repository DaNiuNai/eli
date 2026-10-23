import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { useLanguage } from '@renderer/hooks/use-language'

export function WelcomeDialog({
  open,
  onOpenChange,
  onOpenSettings
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenSettings: () => void
}): React.JSX.Element {
  const { t } = useLanguage()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="pr-6">
          <DialogTitle>{t('👋 欢迎使用 eli')}</DialogTitle>
          <DialogDescription>
            {t(
              '点击“前往设置”，在“模型供应商”中登录账号或填写 API 密钥，连接模型后就能开始对话。运行命令用的终端可以在“通用”中更换。'
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            onClick={() => {
              onOpenChange(false)
              onOpenSettings()
            }}
          >
            {t('前往设置')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
