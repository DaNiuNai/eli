import { createContext, type ReactNode } from 'react'

export const chatSeats = {
  'conversation.composer.dock': { kind: 'list', scope: 'session' },
  'conversation.input.left': { kind: 'list', scope: 'session' },
  'conversation.input.right': { kind: 'list', scope: 'session' },
  'conversation.input.model': { kind: 'single', scope: 'session' },
  'conversation.input.permission': { kind: 'single', scope: 'session' },
  'conversation.input.plan': { kind: 'single', scope: 'session' },
  'conversation.hero.options': { kind: 'list', scope: 'session' },
  'conversation.header.leading': { kind: 'single', scope: 'root' },
  'conversation.session.header.actions': { kind: 'list', scope: 'session' },
  'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
  'conversation.session.header.corner': { kind: 'single', scope: 'session' },
  'sidebar.footer.action': { kind: 'list', scope: 'root' },
  'shell.bottom': { kind: 'single', scope: 'root' },
  'shell.leading': { kind: 'single', scope: 'root' },
  'settings.general.item': { kind: 'list', scope: 'root' },
  'plugins.add.actions': { kind: 'list', scope: 'root' },
  'plugins.detail.actions': { kind: 'list', scope: 'root' },
  'plugins.detail.badge': { kind: 'list', scope: 'root' },
  'plugins.detail.section': { kind: 'list', scope: 'root' },
  'plugins.bundle.config': { kind: 'keyed', scope: 'root' },
  'shell.overlay': { kind: 'list', scope: 'root' }
} as const
type EliDshSeats = { [K in keyof typeof chatSeats]: (typeof chatSeats)[K] & { owner: object } }
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap extends EliDshSeats {}
}
export type Seat = keyof typeof chatSeats
export type Render = (
  key: Seat,
  props: object,
  options?: { fallback?: ReactNode; entryKey?: string }
) => ReactNode
export const DshRenderContext = createContext<Render | undefined>(undefined)
