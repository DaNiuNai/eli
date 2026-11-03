import { builtinBundle } from '../shared/plugin-bundles'
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, net, protocol, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PluginPackages } from '../plugins/packages'
import { PluginManager } from '../plugins/manager'
import type { PluginChange } from '../shared/plugins'
import { is } from '@electron-toolkit/utils'
import type { Context, Plugin } from '@deepseek-ai/cordis'
import { PluginApplication } from '../plugins/kernel'
import { pluginModulePath, pluginProfile, pluginResolver } from '../plugins/config'
import { defaultClientPlugins, pluginsChannels, type PluginEntry } from '../shared/plugins'
import { AppConfig } from './app-config'
import { AgentService } from './agent-service'
import { AppUpdates } from './app-updates'
import { appPreferencesChannels, isUiLanguage } from '../shared/app-preferences'
import { appUpdatesChannels } from '../shared/app-updates'
import { windowAppearanceChannel } from '../shared/window-appearance'
import { terminalChannels } from '../shared/terminal'
import { discoverTerminals, validateTerminal } from './terminal'

interface DesktopEnvironment {
  root: string
  directory: string
  icon: string
}
declare module '@deepseek-ai/cordis' {
  interface Context {
    desktop: DesktopEnvironment
    desktopApplication: PluginApplication
    desktopStartupError: string
    desktopConfig: AppConfig
    desktopWindow: BrowserWindow
    desktopAgent: AgentService
    desktopUpdates: AppUpdates
  }
  interface Events {
    'desktop/preferences-changed'(): void
  }
}

function ipc(ctx: Context, channel: string, handler: (...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (
      event.sender !== ctx.desktopWindow.webContents ||
      event.senderFrame !== ctx.desktopWindow.webContents.mainFrame
    )
      throw new Error('无效的请求来源')
    return handler(...args)
  })
  ctx.effect(() => () => ipcMain.removeHandler(channel))
}

export const desktopProfile: PluginEntry[] = builtinBundle('desktop')

export const desktopPlugins: Readonly<Record<string, Plugin>> = {
  'eli.desktop-config': {
    inject: ['desktop'],
    async apply(ctx) {
      const config = new AppConfig(join(ctx.desktop.root, 'config.json'))
      await config.load()
      ctx.provide('desktopConfig', config)
      ctx.effect(() => () => config.flush())
    }
  },
  'eli.desktop-window': {
    inject: ['desktop', 'desktopConfig'],
    apply(ctx) {
      nativeTheme.themeSource = ctx.desktopConfig.get().theme
      const window = new BrowserWindow({
        width: 1120,
        height: 800,
        minWidth: 680,
        minHeight: 520,
        title: 'eli',
        show: false,
        autoHideMenuBar: true,
        ...(process.platform === 'win32'
          ? {
              titleBarStyle: 'hidden' as const,
              titleBarOverlay: {
                color: '#00000000',
                symbolColor: nativeTheme.shouldUseDarkColors ? '#fafafa' : '#171717',
                height: 40
              },
              backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0a0a' : '#ffffff'
            }
          : {}),
        icon: ctx.desktop.icon,
        webPreferences: {
          preload: join(ctx.desktop.directory, '../preload/index.js'),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false
        }
      })
      ctx.provide('desktopWindow', window)
      window.on('ready-to-show', () => window.show())
      window.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
        return { action: 'deny' }
      })
      window.webContents.on('will-navigate', (event) => event.preventDefault())
      ctx.effect(() => () => {
        if (!window.isDestroyed()) window.destroy()
      })
    }
  },
  'eli.desktop-agent': {
    inject: ['desktopWindow', 'desktopConfig'],
    apply(ctx) {
      const config = ctx.desktopConfig
      const service = new AgentService(
        ctx.desktopWindow,
        config.firstLaunch,
        () => config.get().toolApprovalMode,
        () => config.get().terminal,
        () => config.get().defaultWorkingDirectory
      )
      service.register()
      ctx.provide('desktopAgent', service)
      let terminal = JSON.stringify(config.get().terminal)
      ctx.on('desktop/preferences-changed', () => {
        const next = JSON.stringify(config.get().terminal)
        if (next !== terminal) {
          terminal = next
          service.refreshTerminal()
        }
        service.refreshApprovalMode()
      })
      ctx.effect(() => () => service.dispose())
    }
  },
  'eli.desktop-preferences': {
    inject: ['desktopWindow', 'desktopConfig'],
    apply(ctx) {
      const config = ctx.desktopConfig
      ipc(ctx, appPreferencesChannels.get, () => config.get())
      ipc(ctx, appPreferencesChannels.set, async (value) => {
        await config.set(value)
        nativeTheme.themeSource = config.get().theme
        ctx.emit('desktop/preferences-changed')
      })
      ipc(ctx, appPreferencesChannels.chooseDirectory, async (language) => {
        if (language !== undefined && !isUiLanguage(language)) throw new Error('无效的界面语言')
        const result = await dialog.showOpenDialog(ctx.desktopWindow, {
          title: language === 'en' ? 'Choose default workspace' : '选择默认工作目录',
          defaultPath:
            config.get().defaultWorkingDirectory ?? join(app.getPath('documents'), 'eli'),
          properties: ['openDirectory']
        })
        return result.canceled ? undefined : result.filePaths[0]
      })
      ipc(ctx, windowAppearanceChannel, (dark) => {
        if (typeof dark !== 'boolean') throw new Error('无效的窗口主题请求')
        if (process.platform !== 'win32') return
        ctx.desktopWindow.setTitleBarOverlay({ symbolColor: dark ? '#fafafa' : '#171717' })
        ctx.desktopWindow.setBackgroundColor(dark ? '#0a0a0a' : '#ffffff')
      })
    }
  },
  'eli.desktop-terminal': {
    inject: ['desktopWindow'],
    apply(ctx) {
      ipc(ctx, terminalChannels.discover, () => discoverTerminals())
      ipc(ctx, terminalChannels.validate, (path) => validateTerminal(path))
    }
  },
  'eli.desktop-updates': {
    inject: ['desktopWindow'],
    apply(ctx) {
      const updates = new AppUpdates({
        currentVersion: app.getVersion(),
        fetch: (url, init) => net.fetch(url, init),
        openExternal: (url) => shell.openExternal(url),
        publish: (snapshot) => {
          if (!ctx.desktopWindow.webContents.isDestroyed())
            ctx.desktopWindow.webContents.send(appUpdatesChannels.snapshot, snapshot)
        }
      })
      ctx.provide('desktopUpdates', updates)
      ipc(ctx, appUpdatesChannels.get, () => updates.get())
      ipc(ctx, appUpdatesChannels.check, () => updates.check())
      ipc(ctx, appUpdatesChannels.openRelease, () => updates.openRelease())
    }
  },
  'eli.desktop-client-plugins': {
    inject: ['desktop', 'desktopWindow'],
    apply(ctx) {
      const roots = new Map<string, string>()
      const directories = new Map<string, string>()
      protocol.handle('eli-plugin', async (request) => {
        const url = new URL(request.url)
        const root = roots.get(url.hostname)
        if (!root) return new Response('Plugin not found', { status: 404 })
        try {
          const path = await realpath(resolve(root, `.${decodeURIComponent(url.pathname)}`))
          const within = relative(root, path)
          if (within.startsWith('..') || isAbsolute(within))
            return new Response('Forbidden', { status: 403 })
          if (!/\.(?:m?js|css|wasm|png|jpe?g|webp|svg|woff2?)$/i.test(path))
            return new Response('Unsupported plugin resource', { status: 403 })
          const response = await net.fetch(pathToFileURL(path).href)
          const headers = new Headers(response.headers)
          headers.set('Access-Control-Allow-Origin', '*')
          return new Response(response.body, { status: response.status, headers })
        } catch {
          return new Response('Plugin resource not found', { status: 404 })
        }
      })
      ctx.effect(() => () => protocol.unhandle('eli-plugin'))
      ipc(ctx, pluginsChannels.client, async () => {
        const entries = await pluginProfile(ctx.desktop.root, 'client', defaultClientPlugins)
        return Promise.all(
          entries.map(async (entry) => {
            if (
              entry.disabled ||
              Object.values(defaultClientPlugins).some(({ name }) => name === entry.name)
            )
              return entry
            const path = pluginModulePath(ctx.desktop.root, entry.name)
            if (!/\.(m?js)$/.test(path))
              throw new Error(`界面插件必须提供 JavaScript ESM 文件：${entry.id}`)
            const canonical = await realpath(path)
            const dir = dirname(canonical)
            const id = directories.get(dir) ?? randomUUID()
            roots.set(id, dir)
            directories.set(dir, id)
            return {
              ...entry,
              name: `eli-plugin://${id}/${encodeURIComponent(basename(canonical))}`
            }
          })
        )
      })
    }
  },
  'eli.desktop-plugin-manager': {
    inject: ['desktop', 'desktopWindow', 'desktopApplication', 'desktopAgent', 'desktopConfig'],
    async apply(ctx) {
      const window = ctx.desktopWindow
      const pnpm = app.isPackaged
        ? join(process.resourcesPath, 'plugin-pnpm', 'bin', 'pnpm.cjs')
        : join(app.getAppPath(), 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')
      const waiting = new Map<string, (error?: string) => void>()
      ipc(ctx, pluginsChannels.applied, (id, error) => {
        if (typeof id === 'string' && (error === undefined || typeof error === 'string'))
          waiting.get(id)?.(error)
      })
      const clientReload = (): Promise<void> =>
        new Promise((resolve, reject) => {
          const id = randomUUID()
          const finish = (error?: string): void => {
            clearTimeout(timer)
            waiting.delete(id)
            if (error) reject(new Error(error))
            else resolve()
          }
          const timer = setTimeout(() => finish('界面插件热重载超时'), 20000)
          waiting.set(id, finish)
          window.webContents.send(pluginsChannels.reload, id)
        })
      const service = new PluginManager(
        ctx.desktop.root,
        new PluginPackages(ctx.desktop.root, pnpm),
        async (profiles, rebuild) => {
          let applied = true
          for (const profile of profiles) {
            if (profile === 'client') await clientReload()
            else if (profile === 'desktop') await ctx.desktopApplication.refresh()
            else if (
              ctx.get('desktopAgent') &&
              !(await ctx.desktopAgent.reloadPlugins(profile, rebuild))
            )
              applied = false
          }
          return applied ? '插件配置已生效' : '配置已保存，正在工作的会话将在空闲后应用'
        }
      )
      await service.collect()
      ipc(ctx, pluginsChannels.inventory, async () => {
        const [inventory, runtime] = await Promise.all([
          service.list(),
          ctx.desktopAgent.pluginInventory()
        ])
        runtime.desktop = ctx.desktopApplication.status()
        inventory.startupError = ctx.desktopApplication.ctx.get('desktopStartupError')
        for (const profile of ['desktop', 'control', 'session-host', 'session'] as const) {
          for (const entry of runtime[profile] ?? []) {
            const row = inventory.entries.find((it) => it.profile === profile && it.id === entry.id)
            if (row) row.state = entry.state
            else inventory.entries.push({ ...entry, profile, protected: true })
          }
        }
        return inventory
      })
      ipc(ctx, pluginsChannels.projection, (sessionKey, key) =>
        ctx.desktopAgent.readPluginProjection(sessionKey, key)
      )
      ipc(ctx, pluginsChannels.change, async (value) => {
        const change = value as PluginChange
        if (change?.kind === 'install' || change?.kind === 'update') {
          const english = ctx.desktopConfig.get().language === 'en'
          const source =
            change.kind === 'install' ? change.source : change.name + '@' + change.version
          const scope =
            change.kind === 'install'
              ? change.profile
              : (await service.list()).packages.find((pkg) => pkg.name === change.name)?.target
          const answer = await dialog.showMessageBox(window, {
            type: 'question',
            title: english ? 'Install plugin code' : '安装插件代码',
            message: english ? 'Allow this plugin to run in eli?' : '允许这个插件在 eli 中运行吗？',
            detail: String(source) + '\n' + (english ? 'Scope: ' : '作用域：') + scope,
            buttons: english ? ['Cancel', 'Install'] : ['取消', '安装'],
            defaultId: 0,
            cancelId: 0,
            noLink: true
          })
          if (answer.response !== 1)
            return { inventory: await service.list(), notice: '已取消安装' }
        }
        return service.change(change)
      })
      ipc(ctx, pluginsChannels.versions, (name) => service.versions(String(name)))
      ipc(ctx, pluginsChannels.choose, async () => {
        const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'] })
        return result.canceled ? null : result.filePaths[0]
      })
      ctx.effect(() => () => {
        service.close()
        for (const finish of waiting.values()) finish('窗口已关闭')
      })
    }
  }
}

export async function createDesktop(environment: DesktopEnvironment): Promise<PluginApplication> {
  const source = (): Promise<PluginEntry[]> =>
    pluginProfile(environment.root, 'desktop', desktopProfile)
  const resolver = pluginResolver(environment.root, desktopPlugins)
  const initialize = (): PluginApplication => {
    const application = new PluginApplication()
    application.ctx.provide('desktop', environment)
    application.ctx.provide('desktopApplication', application)
    return application
  }
  let application = initialize()
  try {
    await application.startProfile(source, resolver)
  } catch (error) {
    await application.dispose()
    application = initialize()
    application.ctx.provide('desktopStartupError', String(error))
    // Start with the shipped window and management bridge so a broken external plugin can be removed.
    let recovery = true
    await application.startProfile(async () => {
      if (!recovery) return source()
      recovery = false
      return desktopProfile
    }, resolver)
  }
  const window = application.ctx.get('desktopWindow')
  if (!window) {
    await application.dispose()
    throw new Error('桌面插件配置未提供窗口服务')
  }
  try {
    if (is.dev && process.env.ELECTRON_RENDERER_URL)
      await window.loadURL(process.env.ELECTRON_RENDERER_URL)
    else await window.loadFile(join(environment.directory, '../renderer/index.html'))
  } catch (error) {
    await application.dispose()
    throw error
  }
  return application
}
