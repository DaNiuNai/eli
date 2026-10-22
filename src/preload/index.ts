import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { agentChannels, type AgentApi, type AgentSnapshot } from '../shared/agent'
import { windowAppearanceChannel, type WindowAppearanceApi } from '../shared/window-appearance'
import { appPreferencesChannels, type AppPreferencesApi } from '../shared/app-preferences'
import { agentAuthChannels, type AgentAuthApi, type AgentAuthSnapshot } from '../shared/agent-auth'
import { terminalChannels, type TerminalApi } from '../shared/terminal'

// Custom APIs for renderer
const api: AgentApi = {
  connect: (restart) => ipcRenderer.invoke(agentChannels.connect, restart),
  prompt: (sessionKey, message, imagePaths) =>
    ipcRenderer.invoke(agentChannels.prompt, sessionKey, message, imagePaths),
  compact: (sessionKey, instructions) =>
    ipcRenderer.invoke(agentChannels.compact, sessionKey, instructions),
  editMessage: (target, message) => ipcRenderer.invoke(agentChannels.editMessage, target, message),
  forkMessage: (target) => ipcRenderer.invoke(agentChannels.forkMessage, target),
  abort: (sessionKey) => ipcRenderer.invoke(agentChannels.abort, sessionKey),
  respondToToolApproval: (sessionKey, id, approved) =>
    ipcRenderer.invoke(agentChannels.respondToToolApproval, sessionKey, id, approved),
  respondToUserQuestion: (sessionKey, id, answers) =>
    ipcRenderer.invoke(agentChannels.respondToUserQuestion, sessionKey, id, answers),
  newSession: (cwd) => ipcRenderer.invoke(agentChannels.newSession, cwd),
  openSession: (path) => ipcRenderer.invoke(agentChannels.openSession, path),
  deleteSession: (path) => ipcRenderer.invoke(agentChannels.deleteSession, path),
  getLibrary: () => ipcRenderer.invoke(agentChannels.getLibrary),
  getSkills: (sessionKey) => ipcRenderer.invoke(agentChannels.getSkills, sessionKey),
  getSettings: () => ipcRenderer.invoke(agentChannels.getSettings),
  saveSettings: (changes) => ipcRenderer.invoke(agentChannels.saveSettings, changes),
  readImage: (source) => ipcRenderer.invoke(agentChannels.readImage, source),
  chooseImages: (language) => ipcRenderer.invoke(agentChannels.chooseImages, language),
  saveImageData: (bytes) => ipcRenderer.invoke(agentChannels.saveImageData, bytes),
  getImagePath: (file) => webUtils.getPathForFile(file),
  setThinkingLevel: (sessionKey, level) =>
    ipcRenderer.invoke(agentChannels.setThinkingLevel, sessionKey, level),
  setModel: (sessionKey, provider, modelId) =>
    ipcRenderer.invoke(agentChannels.setModel, sessionKey, provider, modelId),
  chooseDirectory: (language) => ipcRenderer.invoke(agentChannels.chooseDirectory, language),
  onSnapshot: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: AgentSnapshot): void =>
      listener(snapshot)
    ipcRenderer.on(agentChannels.snapshot, handler)
    return () => ipcRenderer.removeListener(agentChannels.snapshot, handler)
  }
}

contextBridge.exposeInMainWorld('api', api)

const agentAuth: AgentAuthApi = {
  get: () => ipcRenderer.invoke(agentAuthChannels.get),
  login: (providerId, type) => ipcRenderer.invoke(agentAuthChannels.login, providerId, type),
  respond: (promptId, value) => ipcRenderer.invoke(agentAuthChannels.respond, promptId, value),
  cancel: () => ipcRenderer.invoke(agentAuthChannels.cancel),
  openLink: (url) => ipcRenderer.invoke(agentAuthChannels.openLink, url),
  onSnapshot: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: AgentAuthSnapshot): void =>
      listener(snapshot)
    ipcRenderer.on(agentAuthChannels.snapshot, handler)
    return () => ipcRenderer.removeListener(agentAuthChannels.snapshot, handler)
  }
}

contextBridge.exposeInMainWorld('agentAuth', agentAuth)

const appPreferences: AppPreferencesApi = {
  get: () => ipcRenderer.invoke(appPreferencesChannels.get),
  set: (preferences) => ipcRenderer.invoke(appPreferencesChannels.set, preferences)
}

contextBridge.exposeInMainWorld('appPreferences', appPreferences)

const terminal: TerminalApi = {
  discover: () => ipcRenderer.invoke(terminalChannels.discover),
  validate: (path) => ipcRenderer.invoke(terminalChannels.validate, path)
}

contextBridge.exposeInMainWorld('terminal', terminal)

const windowAppearance: WindowAppearanceApi = {
  customTitleBar: process.platform === 'win32',
  setDarkMode: (dark) => ipcRenderer.invoke(windowAppearanceChannel, dark)
}

contextBridge.exposeInMainWorld('windowAppearance', windowAppearance)
