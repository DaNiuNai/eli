import type { ReactNode } from 'react'
import { useSortable } from '@dnd-kit/react/sortable'
import { SidebarMenuItem } from '@renderer/components/ui/sidebar'

export function SortableSidebarItem({
  id,
  index,
  group,
  disabled,
  className,
  children
}: {
  id: string
  index: number
  group: string
  disabled: boolean
  className?: string
  children: (handleRef: (element: Element | null) => void) => ReactNode
}): React.JSX.Element {
  const { ref, handleRef } = useSortable({
    id,
    index,
    group,
    type: group,
    accept: group,
    disabled
  })

  return (
    <SidebarMenuItem ref={ref} className={className}>
      {children(handleRef)}
    </SidebarMenuItem>
  )
}
