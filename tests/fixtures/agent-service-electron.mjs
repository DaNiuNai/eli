import { EventEmitter } from 'node:events'
import { emptySessionSnapshot } from '../../src/shared/agent-state.ts'

export const fixture = {
  runtimes: [],
  library: { sessions: [], usage: [], updatedAt: 0, warning: null }
}

export class BrowserWindow extends EventEmitter {
  webContents = {
    mainFrame: {},
    sent: [],
    isDestroyed: () => false,
    send(channel, snapshot) {
      this.sent.push({ channel, snapshot: structuredClone(snapshot) })
    }
  }

  isDestroyed = this.webContents.isDestroyed
}

export const ipcMain = {
  handlers: new Map(),
  handle(channel, action) {
    this.handlers.set(channel, action)
  },
  removeHandler(channel) {
    this.handlers.delete(channel)
  }
}

export const dialog = {
  calls: [],
  result: { canceled: true, filePaths: [] },
  async showOpenDialog(_window, options) {
    this.calls.push(options)
    return this.result
  }
}

export const shell = {
  openExternal: async () => undefined,
  trashItem: async () => undefined
}

export const utilityProcess = {
  fork() {
    const child = new EventEmitter()
    child.stdout = { resume: () => undefined }
    child.stderr = new EventEmitter()
    child.calls = []
    child.kill = () => child.emit('exit', 0)
    child.postMessage = (request) => {
      child.calls.push(request)
      queueMicrotask(() => {
        try {
          let result
          const [options] = request.args
          switch (request.method) {
            case 'initialize':
              child.options = options
              if (options.kind === 'session') {
                child.state = {
                  snapshot: {
                    ...emptySessionSnapshot(options.cwd, options.sessionKey, options.sessionFile),
                    connection: 'ready'
                  },
                  summary: null,
                  persistedFile: options.sessionFile
                }
              }
              result = child.state ?? null
              break
            case 'getLibrary':
              result = fixture.library
              break
            case 'findSession':
              result = fixture.library.sessions.find((session) => session.path === options)
              if (!result) throw new Error('该会话不在本机历史记录中，请刷新列表')
              break
            case 'hasWorkspace':
              result = fixture.library.sessions.some((session) => session.cwd === options)
              break
            case 'shutdown':
              break
            default:
              throw new Error(`未预期的 Runtime 调用：${request.method}`)
          }
          child.emit('message', {
            version: request.version,
            kind: 'response',
            id: request.id,
            ok: true,
            result: structuredClone(result)
          })
        } catch (error) {
          child.emit('message', {
            version: request.version,
            kind: 'response',
            id: request.id,
            ok: false,
            error: error.message
          })
        }
      })
    }
    fixture.runtimes.push(child)
    queueMicrotask(() => child.emit('message', { version: 1, kind: 'ready' }))
    return child
  }
}
