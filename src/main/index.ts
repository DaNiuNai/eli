import { app, BrowserWindow, dialog, protocol } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { runtimePaths } from '../runtime/paths'
import { createDesktop } from './plugins'
import type { PluginApplication } from '../plugins/kernel'

const root = runtimePaths().root
const desktopDirectory = join(root, 'desktop')
mkdirSync(desktopDirectory, { recursive: true })
app.setPath('userData', desktopDirectory)
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'eli-plugin',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
  }
])
const hasInstanceLock = app.requestSingleInstanceLock()
if (!hasInstanceLock) app.quit()

let desktop: PluginApplication | undefined
let opening: Promise<void> | undefined
let closing = Promise.resolve()
let quitting = false

async function open(): Promise<void> {
  if (opening) return opening
  opening = (async () => {
    await closing
    try {
      desktop = await createDesktop({ root, directory: import.meta.dirname, icon })
      desktop.ctx.get('desktopWindow')!.once('closed', () => {
        const current = desktop
        desktop = undefined
        closing = current?.dispose() ?? Promise.resolve()
        void closing.catch((error: unknown) => dialog.showErrorBox('eli 关闭失败', String(error)))
      })
    } catch (error) {
      dialog.showErrorBox('eli 启动失败', error instanceof Error ? error.message : String(error))
      app.quit()
    }
  })().finally(() => {
    opening = undefined
  })
  return opening
}

app.on('second-instance', () => {
  const window = BrowserWindow.getAllWindows()[0]
  if (window?.isMinimized()) window.restore()
  window?.focus()
})
app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
if (hasInstanceLock)
  void app.whenReady().then(async () => {
    electronApp.setAppUserModelId('com.eli.desktop')
    await open()
    app.on('activate', () => {
      if (!BrowserWindow.getAllWindows().length) void open()
    })
  })
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
app.on('before-quit', (event) => {
  if (quitting) return
  event.preventDefault()
  quitting = true
  void Promise.allSettled([desktop?.dispose(), closing]).then(() => app.quit())
})
