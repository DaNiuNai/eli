import './assets/shadcn.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Alert, AlertDescription, AlertTitle } from '@renderer/components/ui/alert'
import { loadAppPreferences } from '@renderer/lib/app-preferences'
import { PluginApplication } from '../../plugins/kernel'
import { clientPlugins } from './plugins/builtins'
import { ClientApplication, PluginContext } from './plugins/context'
import { clientModuleResolver } from './plugins/dsh-modules'
import { defaultClientPlugins } from '../../shared/plugins'

async function start(): Promise<void> {
  const root = createRoot(document.getElementById('root')!)
  let application = new PluginApplication()
  try {
    await loadAppPreferences()
    try {
      const entries = await window.plugins.client()
      await application.start(entries, await clientModuleResolver(entries, clientPlugins))
    } catch (error) {
      await application.dispose()
      application = new PluginApplication()
      application.ctx.provide('clientStartupError', String(error))
      await application.start(
        defaultClientPlugins,
        await clientModuleResolver(defaultClientPlugins, clientPlugins)
      )
    }
    const unsubscribe = window.plugins.onClientReload(async () => {
      const next = await window.plugins.client()
      await application.reload(next, await clientModuleResolver(next, clientPlugins))
    })
    const registry = application.ctx.get('ui')
    if (!registry || !registry.read('shell').length) throw new Error('界面插件配置未提供应用界面')
    root.render(
      <StrictMode>
        <ClientApplication value={application}>
          <PluginContext value={registry}>
            {application.ctx.slots.renderSlot('root', {})}
          </PluginContext>
        </ClientApplication>
      </StrictMode>
    )
    const close = (): void => {
      unsubscribe()
      root.unmount()
      void application.dispose()
    }
    window.addEventListener('beforeunload', close, { once: true })
    import.meta.hot?.dispose(() => {
      window.removeEventListener('beforeunload', close)
      close()
    })
  } catch (error) {
    await application.dispose()
    root.render(
      <div className="p-6">
        <Alert variant="destructive">
          <AlertTitle>无法启动 eli 界面</AlertTitle>
          <AlertDescription>
            {error instanceof Error ? error.message : String(error)}
          </AlertDescription>
        </Alert>
      </div>
    )
  }
}

void start()
