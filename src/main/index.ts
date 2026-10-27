import { app, shell, BrowserWindow, dialog, ipcMain, nativeTheme, net } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { AgentService } from './agent-service'
import { windowAppearanceChannel } from '../shared/window-appearance'
import { appPreferencesChannels, isUiLanguage } from '../shared/app-preferences'
import { AppConfig } from './app-config'
import { terminalChannels } from '../shared/terminal'
import { discoverTerminals, validateTerminal } from './terminal'
import { runtimePaths } from '../runtime/paths'
import { mkdirSync } from 'node:fs'
import { AppUpdates } from './app-updates'
import { appUpdatesChannels } from '../shared/app-updates'

const appConfig = new AppConfig()
const desktopDirectory = join(runtimePaths().root, 'desktop')
mkdirSync(desktopDirectory, { recursive: true })
app.setPath('userData', desktopDirectory)
const hasInstanceLock = app.requestSingleInstanceLock()
if (!hasInstanceLock) app.quit()
app.on('second-instance', () => {
  const window = BrowserWindow.getAllWindows()[0]
  if (window?.isMinimized()) window.restore()
  window?.focus()
})
let agentService: AgentService | undefined
const closingServices = new Set<Promise<void>>()
let quitting = false
const appUpdates = new AppUpdates({
  currentVersion: app.getVersion(),
  fetch: (url, init) => net.fetch(url, init),
  openExternal: (url) => shell.openExternal(url),
  publish: (snapshot) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.webContents.isDestroyed()) {
        window.webContents.send(appUpdatesChannels.snapshot, snapshot)
      }
    }
  }
})

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
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
    icon,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  const assertSender = (event: Electron.IpcMainInvokeEvent): void => {
    if (
      event.sender !== mainWindow.webContents ||
      event.senderFrame !== mainWindow.webContents.mainFrame
    ) {
      throw new Error('无效的设置请求来源')
    }
  }
  ipcMain.handle(appPreferencesChannels.get, (event) => {
    assertSender(event)
    return appConfig.get()
  })
  ipcMain.handle(appPreferencesChannels.chooseDirectory, async (event, language: unknown) => {
    assertSender(event)
    if (language !== undefined && !isUiLanguage(language)) throw new Error('无效的界面语言')
    const result = await dialog.showOpenDialog(mainWindow, {
      title: language === 'en' ? 'Choose default workspace' : '选择默认工作目录',
      defaultPath: appConfig.get().defaultWorkingDirectory ?? join(app.getPath('documents'), 'eli'),
      properties: ['openDirectory']
    })
    return result.canceled ? undefined : result.filePaths[0]
  })
  ipcMain.handle(appUpdatesChannels.get, (event) => {
    assertSender(event)
    return appUpdates.get()
  })
  ipcMain.handle(appUpdatesChannels.check, (event) => {
    assertSender(event)
    return appUpdates.check()
  })
  ipcMain.handle(appUpdatesChannels.openRelease, (event) => {
    assertSender(event)
    return appUpdates.openRelease()
  })
  ipcMain.handle(appPreferencesChannels.set, async (event, value: unknown) => {
    assertSender(event)
    const previousTerminal = JSON.stringify(appConfig.get().terminal)
    await appConfig.set(value)
    if (previousTerminal !== JSON.stringify(appConfig.get().terminal)) {
      agentService?.refreshTerminal()
    }
    agentService?.refreshApprovalMode()
    nativeTheme.themeSource = appConfig.get().theme
  })
  ipcMain.handle(terminalChannels.discover, (event) => {
    assertSender(event)
    return discoverTerminals()
  })
  ipcMain.handle(terminalChannels.validate, (event, path: unknown) => {
    assertSender(event)
    return validateTerminal(path)
  })
  ipcMain.handle(windowAppearanceChannel, (event, dark: unknown) => {
    if (
      event.sender !== mainWindow.webContents ||
      event.senderFrame !== mainWindow.webContents.mainFrame ||
      typeof dark !== 'boolean'
    ) {
      throw new Error('无效的窗口主题请求')
    }
    if (process.platform !== 'win32') return
    mainWindow.setTitleBarOverlay({ symbolColor: dark ? '#fafafa' : '#171717' })
    mainWindow.setBackgroundColor(dark ? '#0a0a0a' : '#ffffff')
  })
  agentService = new AgentService(
    mainWindow,
    appConfig.firstLaunch,
    () => appConfig.get().toolApprovalMode,
    () => appConfig.get().terminal,
    () => appConfig.get().defaultWorkingDirectory
  )
  agentService.register()
  mainWindow.on('closed', () => {
    ipcMain.removeHandler(appPreferencesChannels.get)
    ipcMain.removeHandler(appPreferencesChannels.set)
    ipcMain.removeHandler(appPreferencesChannels.chooseDirectory)
    ipcMain.removeHandler(appUpdatesChannels.get)
    ipcMain.removeHandler(appUpdatesChannels.check)
    ipcMain.removeHandler(appUpdatesChannels.openRelease)
    ipcMain.removeHandler(terminalChannels.discover)
    ipcMain.removeHandler(terminalChannels.validate)
    ipcMain.removeHandler(windowAppearanceChannel)
    if (agentService) {
      const closing = agentService.dispose()
      closingServices.add(closing)
      void closing.finally(() => closingServices.delete(closing))
    }
    agentService = undefined
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (/^https?:\/\//i.test(details.url)) void shell.openExternal(details.url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
if (hasInstanceLock)
  app.whenReady().then(async () => {
    try {
      await appConfig.load()
    } catch (error) {
      dialog.showErrorBox('无法加载 eli 配置', `${appConfig.path}\n${String(error)}`)
      app.quit()
      return
    }
    nativeTheme.themeSource = appConfig.get().theme
    // Set app user model id for windows
    electronApp.setAppUserModelId('com.eli.desktop')

    // Default open or close DevTools by F12 in development
    // and ignore CommandOrControl + R in production.
    // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    createWindow()

    app.on('activate', function () {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', (event) => {
  if (quitting) return
  event.preventDefault()
  quitting = true
  void Promise.allSettled([agentService?.dispose(), ...closingServices, appConfig.flush()]).then(
    () => app.quit()
  )
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
