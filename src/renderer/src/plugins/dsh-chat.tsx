import type { Context, Plugin } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { PluginProviders, PluginSlot } from './slots'
import { installSessionScope } from './dsh-session'
import { chatSeats, DshRenderContext, type Render } from './dsh-context'

export const dshChatSlots: Plugin = {
  inject: ['slots', 'ui'],
  apply(ctx: Context) {
    installSessionScope(ctx)
    ctx.slots.register(
      { name: 'root', children: chatSeats },
      ({ renderSlot }: { renderSlot: Render }) => (
        <DshRenderContext.Provider value={renderSlot}>
          <PluginProviders>
            <PluginSlot name="shell" />
          </PluginProviders>
        </DshRenderContext.Provider>
      )
    )
  }
}
