import { contextBridge, ipcRenderer } from 'electron'
import { piChannels, type PiApi, type PiSnapshot } from '../shared/pi'
import { windowAppearanceChannel, type WindowAppearanceApi } from '../shared/window-appearance'
import { appPreferencesChannels, type AppPreferencesApi } from '../shared/app-preferences'

// Custom APIs for renderer
const api: PiApi = {
  connect: (restart) => ipcRenderer.invoke(piChannels.connect, restart),
  prompt: (sessionKey, message) => ipcRenderer.invoke(piChannels.prompt, sessionKey, message),
  editMessage: (target, message) => ipcRenderer.invoke(piChannels.editMessage, target, message),
  forkMessage: (target) => ipcRenderer.invoke(piChannels.forkMessage, target),
  abort: (sessionKey) => ipcRenderer.invoke(piChannels.abort, sessionKey),
  newSession: (cwd) => ipcRenderer.invoke(piChannels.newSession, cwd),
  openSession: (path) => ipcRenderer.invoke(piChannels.openSession, path),
  deleteSession: (path) => ipcRenderer.invoke(piChannels.deleteSession, path),
  getLibrary: () => ipcRenderer.invoke(piChannels.getLibrary),
  getSettings: () => ipcRenderer.invoke(piChannels.getSettings),
  saveSettings: (changes) => ipcRenderer.invoke(piChannels.saveSettings, changes),
  readImage: (source) => ipcRenderer.invoke(piChannels.readImage, source),
  setThinkingLevel: (sessionKey, level) =>
    ipcRenderer.invoke(piChannels.setThinkingLevel, sessionKey, level),
  setModel: (sessionKey, provider, modelId) =>
    ipcRenderer.invoke(piChannels.setModel, sessionKey, provider, modelId),
  chooseDirectory: (language) => ipcRenderer.invoke(piChannels.chooseDirectory, language),
  onSnapshot: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: PiSnapshot): void =>
      listener(snapshot)
    ipcRenderer.on(piChannels.snapshot, handler)
    return () => ipcRenderer.removeListener(piChannels.snapshot, handler)
  }
}

contextBridge.exposeInMainWorld('api', api)

const appPreferences: AppPreferencesApi = {
  get: () => ipcRenderer.invoke(appPreferencesChannels.get),
  set: (preferences) => ipcRenderer.invoke(appPreferencesChannels.set, preferences)
}

contextBridge.exposeInMainWorld('appPreferences', appPreferences)

const windowAppearance: WindowAppearanceApi = {
  customTitleBar: process.platform === 'win32',
  setDarkMode: (dark) => ipcRenderer.invoke(windowAppearanceChannel, dark)
}

contextBridge.exposeInMainWorld('windowAppearance', windowAppearance)
