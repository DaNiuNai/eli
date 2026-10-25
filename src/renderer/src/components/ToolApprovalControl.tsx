import {
  ChevronDownIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  ShieldQuestionIcon,
  ShieldEllipsisIcon
} from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { useLanguage } from '@renderer/hooks/use-language'
import { isToolApprovalMode, type ToolApprovalMode } from '../../../shared/tool-approval'

const modes = [
  {
    value: 'request',
    label: '请求批注',
    description: '只读工具自动放行，其他工具逐次审批。',
    icon: ShieldQuestionIcon
  },
  {
    value: 'edit',
    label: '批准编辑',
    description: '仅自动放行 read、write、edit，其他工具逐次审批。',
    icon: ShieldCheckIcon
  },
  {
    value: 'auto',
    label: '自动批准',
    description: '由 AI 审核工具调用，无法确定时询问你。',
    icon: ShieldEllipsisIcon
  },
  {
    value: 'all',
    label: '全部放行',
    description: '所有工具直接执行，无需审批。',
    icon: ShieldAlertIcon
  }
] as const

export function ToolApprovalControl({
  value,
  disabled,
  onChange
}: {
  value: ToolApprovalMode
  disabled: boolean
  onChange: (mode: ToolApprovalMode) => void
}): React.JSX.Element {
  const { t } = useLanguage()
  const selected = modes.find((mode) => mode.value === value) ?? modes[0]
  const Icon = selected.icon
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant={value === 'all' ? 'destructive' : 'ghost'} size="sm" />}
        aria-label={t('工具审批：{mode}', { mode: t(selected.label) })}
        title={t('全局工具审批')}
        disabled={disabled}
      >
        <Icon data-icon="inline-start" />
        {t(selected.label)}
        <ChevronDownIcon data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        className="w-max min-w-80 max-w-[calc(100vw-2rem)]"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('全局工具审批')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={(next) => {
              if (isToolApprovalMode(next)) onChange(next)
            }}
          >
            {modes.map(({ value: mode, label, description, icon: ModeIcon }) => (
              <DropdownMenuRadioItem key={mode} value={mode}>
                <span className="flex min-w-0 flex-col gap-1 py-1">
                  <span className={mode === 'all' ? 'text-destructive' : undefined}>
                    <span className="flex items-center gap-2">
                      <ModeIcon />
                      {t(label)}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">{t(description)}</span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
