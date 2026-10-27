import type { ReactNode } from 'react'
import { ChevronRightIcon, type LucideIcon } from 'lucide-react'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@renderer/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@renderer/components/ui/collapsible'
import { useLanguage } from '@renderer/hooks/use-language'

export function TaskPanelSection({
  title,
  description,
  count,
  icon: Icon,
  children
}: {
  title: string
  description: string
  count: number
  icon: LucideIcon
  children: ReactNode
}): React.JSX.Element {
  const { t } = useLanguage()
  return (
    <Collapsible defaultOpen render={<Card size="sm" className="w-full gap-0 py-1" />}>
      <CardHeader className="p-1">
        <CardTitle>
          <CollapsibleTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className="group/task-panel w-full justify-start gap-2"
              />
            }
            aria-label={t('展开或收起{title}', { title })}
          >
            <Icon data-icon="inline-start" />
            <span className="min-w-0 flex-1 truncate text-left">{title}</span>
            <Badge variant="secondary">{count}</Badge>
            <ChevronRightIcon
              data-icon="inline-end"
              className="transition-transform group-aria-expanded/task-panel:rotate-90 motion-reduce:transition-none"
            />
          </CollapsibleTrigger>
        </CardTitle>
        <CardDescription className="sr-only">{description}</CardDescription>
      </CardHeader>
      <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none">
        <CardContent className="max-h-[60dvh] overflow-auto px-1 pb-1">{children}</CardContent>
      </CollapsibleContent>
    </Collapsible>
  )
}
