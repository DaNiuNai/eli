import { contextBridge, ipcRenderer } from 'electron'
import { piChannels, type PiApi, type PiSnapshot } from '../shared/pi'

// Custom APIs for renderer
const api: PiApi = {
  connect: (restart) => ipcRenderer.invoke(piChannels.connect, restart),
  prompt: (message) => ipcRenderer.invoke(piChannels.prompt, message),
  abort: () => ipcRenderer.invoke(piChannels.abort),
  newSession: () => ipcRenderer.invoke(piChannels.newSession),
  setModel: (provider, modelId) => ipcRenderer.invoke(piChannels.setModel, provider, modelId),
  chooseDirectory: () => ipcRenderer.invoke(piChannels.chooseDirectory),
  onSnapshot: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: PiSnapshot): void =>
      listener(snapshot)
    ipcRenderer.on(piChannels.snapshot, handler)
    return () => ipcRenderer.removeListener(piChannels.snapshot, handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
