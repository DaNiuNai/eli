import { app, shell, BrowserWindow, dialog, ipcMain, nativeTheme } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { PiService } from './pi-service'
import { windowAppearanceChannel } from '../shared/window-appearance'
import { appPreferencesChannels } from '../shared/app-preferences'
import { AppConfig } from './app-config'

const appConfig = new AppConfig()
let piService: PiService | undefined
let quitting = false

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
      preload: join(__dirname, '../preload/index.js'),
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
  ipcMain.handle(appPreferencesChannels.set, async (event, value: unknown) => {
    assertSender(event)
    await appConfig.set(value)
    nativeTheme.themeSource = appConfig.get().theme
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
  piService = new PiService(mainWindow)
  piService.register()
  mainWindow.on('closed', () => {
    ipcMain.removeHandler(appPreferencesChannels.get)
    ipcMain.removeHandler(appPreferencesChannels.set)
    ipcMain.removeHandler(windowAppearanceChannel)
    void piService?.dispose()
    piService = undefined
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
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
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
  void Promise.allSettled([piService?.dispose(), appConfig.flush()]).then(() => app.quit())
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
