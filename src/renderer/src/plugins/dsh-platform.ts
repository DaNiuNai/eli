import * as Zod from 'zod'
import * as ReactVirtual from '@tanstack/react-virtual'
import * as ClientStore from '@deepseek-ai/dsh-client-store'
import * as UiPrimitives from '@deepseek-ai/dsh-client-ui-primitives'
import * as UiDockkit from '@deepseek-ai/dsh-client-ui-dockkit'

// Browser halves receive the same module names as the dsh Web kernel.
export const dshPlatform: Record<string, unknown> = {
  zod: Zod,
  '@tanstack/react-virtual': ReactVirtual,
  '@deepseek-ai/dsh-client-store': ClientStore,
  '@deepseek-ai/dsh-client-ui-primitives': UiPrimitives,
  '@deepseek-ai/dsh-client-ui-dockkit': UiDockkit
}
