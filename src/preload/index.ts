import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { agentChannels, type AgentApi, type AgentSnapshot } from '../shared/agent'
import { windowAppearanceChannel, type WindowAppearanceApi } from '../shared/window-appearance'
import { appPreferencesChannels, type AppPreferencesApi } from '../shared/app-preferences'
import { agentAuthChannels, type AgentAuthApi, type AgentAuthSnapshot } from '../shared/agent-auth'
import { providersChannels, type ProvidersApi } from '../shared/providers'
import { terminalChannels, type TerminalApi } from '../shared/terminal'
import { mcpAuthChannels, type McpAuthApi, type McpAuthSnapshot } from '../shared/mcp'
import {
  appUpdatesChannels,
  type AppUpdatesApi,
  type AppUpdateSnapshot
} from '../shared/app-updates'

// Custom APIs for renderer
const api: AgentApi = {
  connect: (restart) => ipcRenderer.invoke(agentChannels.connect, restart),
  prompt: (sessionKey, message, attachmentPaths) =>
    ipcRenderer.invoke(agentChannels.prompt, sessionKey, message, attachmentPaths),
  compact: (sessionKey, instructions) =>
    ipcRenderer.invoke(agentChannels.compact, sessionKey, instructions),
  editMessage: (target, message) => ipcRenderer.invoke(agentChannels.editMessage, target, message),
  forkMessage: (target) => ipcRenderer.invoke(agentChannels.forkMessage, target),
  abort: (sessionKey) => ipcRenderer.invoke(agentChannels.abort, sessionKey),
  stopBackgroundTask: (sessionKey, id) =>
    ipcRenderer.invoke(agentChannels.stopBackgroundTask, sessionKey, id),
  controlSubagent: (sessionKey, action) =>
    ipcRenderer.invoke(agentChannels.controlSubagent, sessionKey, action),
  respondToToolApproval: (sessionKey, id, approved) =>
    ipcRenderer.invoke(agentChannels.respondToToolApproval, sessionKey, id, approved),
  respondToUserQuestion: (sessionKey, id, answers) =>
    ipcRenderer.invoke(agentChannels.respondToUserQuestion, sessionKey, id, answers),
  newSession: (cwd) => ipcRenderer.invoke(agentChannels.newSession, cwd),
  openSession: (path) => ipcRenderer.invoke(agentChannels.openSession, path),
  deleteSession: (path) => ipcRenderer.invoke(agentChannels.deleteSession, path),
  getLibrary: () => ipcRenderer.invoke(agentChannels.getLibrary),
  getSkills: (sessionKey) => ipcRenderer.invoke(agentChannels.getSkills, sessionKey),
  getUserSkills: () => ipcRenderer.invoke(agentChannels.getUserSkills),
  installCommonSkills: () => ipcRenderer.invoke(agentChannels.installCommonSkills),
  getMcpServers: () => ipcRenderer.invoke(agentChannels.getMcpServers),
  changeMcpServer: (change) => ipcRenderer.invoke(agentChannels.changeMcpServer, change),
  testMcpServer: (name) => ipcRenderer.invoke(agentChannels.testMcpServer, name),
  setSkillEnabled: (filePath, enabled) =>
    ipcRenderer.invoke(agentChannels.setSkillEnabled, filePath, enabled),
  getSettings: () => ipcRenderer.invoke(agentChannels.getSettings),
  saveSettings: (changes) => ipcRenderer.invoke(agentChannels.saveSettings, changes),
  readImage: (source) => ipcRenderer.invoke(agentChannels.readImage, source),
  chooseFiles: (language) => ipcRenderer.invoke(agentChannels.chooseFiles, language),
  saveImageData: (bytes) => ipcRenderer.invoke(agentChannels.saveImageData, bytes),
  saveFileData: (name, bytes) => ipcRenderer.invoke(agentChannels.saveFileData, name, bytes),
  getFilePath: (file) => webUtils.getPathForFile(file),
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

const mcpAuth: McpAuthApi = {
  get: () => ipcRenderer.invoke(mcpAuthChannels.get),
  start: (name, force) => ipcRenderer.invoke(mcpAuthChannels.start, name, force),
  signOut: (name) => ipcRenderer.invoke(mcpAuthChannels.signOut, name),
  cancel: (id) => ipcRenderer.invoke(mcpAuthChannels.cancel, id),
  respond: (id, url) => ipcRenderer.invoke(mcpAuthChannels.respond, id, url),
  openLink: (id) => ipcRenderer.invoke(mcpAuthChannels.openLink, id),
  openWebsite: (name) => ipcRenderer.invoke(mcpAuthChannels.openWebsite, name),
  onSnapshot: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: McpAuthSnapshot): void =>
      listener(snapshot)
    ipcRenderer.on(mcpAuthChannels.snapshot, handler)
    return () => ipcRenderer.removeListener(mcpAuthChannels.snapshot, handler)
  }
}
contextBridge.exposeInMainWorld('mcpAuth', mcpAuth)

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
const providers: ProvidersApi = {
  get: () => ipcRenderer.invoke(providersChannels.get),
  change: (change) => ipcRenderer.invoke(providersChannels.change, change),
  onChanged: (listener) => {
    const handler = (): void => listener()
    ipcRenderer.on(providersChannels.changed, handler)
    return () => ipcRenderer.removeListener(providersChannels.changed, handler)
  }
}
contextBridge.exposeInMainWorld('providers', providers)

const appPreferences: AppPreferencesApi = {
  get: () => ipcRenderer.invoke(appPreferencesChannels.get),
  set: (preferences) => ipcRenderer.invoke(appPreferencesChannels.set, preferences)
}

contextBridge.exposeInMainWorld('appPreferences', appPreferences)

const appUpdates: AppUpdatesApi = {
  get: () => ipcRenderer.invoke(appUpdatesChannels.get),
  check: () => ipcRenderer.invoke(appUpdatesChannels.check),
  openRelease: () => ipcRenderer.invoke(appUpdatesChannels.openRelease),
  onSnapshot: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: AppUpdateSnapshot): void =>
      listener(snapshot)
    ipcRenderer.on(appUpdatesChannels.snapshot, handler)
    return () => ipcRenderer.removeListener(appUpdatesChannels.snapshot, handler)
  }
}

contextBridge.exposeInMainWorld('appUpdates', appUpdates)

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
