import './assets/shadcn.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Alert, AlertDescription, AlertTitle } from '@renderer/components/ui/alert'
import { loadAppPreferences } from '@renderer/lib/app-preferences'
import { PluginApplication } from '../../plugins/kernel'
import { clientPlugins } from './plugins/builtins'
import { PluginContext } from './plugins/context'
import { PluginProviders, PluginSlot } from './plugins/slots'
import type { Plugin } from '@deepseek-ai/cordis'

async function start(): Promise<void> {
  const root = createRoot(document.getElementById('root')!)
  const application = new PluginApplication()
  try {
    await loadAppPreferences()
    await application.start(await window.plugins.client(), async (name) => {
      if (Object.hasOwn(clientPlugins, name)) return clientPlugins[name]
      if (!name.startsWith('eli-plugin://')) throw new Error(`界面插件模块无效：${name}`)
      const module = await import(/* @vite-ignore */ name)
      const plugin: unknown = module.default ?? module
      if (
        typeof plugin !== 'function' &&
        (!plugin ||
          typeof plugin !== 'object' ||
          !('apply' in plugin) ||
          typeof plugin.apply !== 'function')
      )
        throw new Error(`界面插件未导出 Cordis 插件：${name}`)
      return plugin as Plugin
    })
    const registry = application.ctx.get('ui')
    if (!registry || !registry.read('shell').length) throw new Error('界面插件配置未提供应用界面')
    root.render(
      <StrictMode>
        <PluginContext value={registry}>
          <PluginProviders>
            <PluginSlot name="shell" />
          </PluginProviders>
        </PluginContext>
      </StrictMode>
    )
    const close = (): void => {
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
