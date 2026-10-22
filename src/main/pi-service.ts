import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { relative, resolve } from 'node:path'
import { homedir } from 'node:os'
import { stat } from 'node:fs/promises'
import type { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { piChannels, type PiSnapshot, type PiThinkingLevel } from '../shared/pi'
import { PiLibraryService } from './pi-library'
import { PiSession } from './pi-session'
import { readLocalImage } from './image-files'
import { copySessionThrough } from './pi-history'
import { PiSettingsService } from './pi-settings'
import { PiAuthService } from './pi-auth'
import { piAuthChannels } from '../shared/pi-auth'
import type { ToolApprovalMode } from '../shared/tool-approval'

function promptText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 100_000) {
    throw new Error('请输入 1 至 100000 个字符的消息')
  }
  return value.trim()
}

/** 主进程只切换当前视图；每个会话的进程、锁和事件流均独立维护。 */
export class PiService {
  private auth: PiAuthService
  private library = new PiLibraryService()
  private settings = new PiSettingsService()
  private sessions = new Map<string, PiSession>()
  private current?: PiSession
  private runtime?: Promise<ModelRuntime>
  private connecting?: Promise<PiSnapshot>
  private navigation: Promise<void> = Promise.resolve()
  private broadcastTimer?: ReturnType<typeof setTimeout>
  private disposing?: Promise<void>
  private disposed = false
  private revision = 0
  private libraryVersion = 0
  private workspacePaths = new Set<string>()
  private unavailableWorkspaces = new Set<string>()
  private workspaceTimer?: ReturnType<typeof setInterval>
  private checkingWorkspaces?: Promise<void>

  constructor(
    private readonly window: BrowserWindow,
    firstLaunch = false,
    private readonly approvalMode: () => ToolApprovalMode = () => 'request'
  ) {
    this.auth = new PiAuthService(window, firstLaunch, this.models, async () => {
      await this.navigate(async () => {
        await Promise.all([...this.sessions.values()].map((session) => session.refreshAuth()))
        this.publish()
      })
    })
  }

  private models = (): Promise<ModelRuntime> => {
    this.runtime ??= import('@earendil-works/pi-coding-agent')
      .then(({ ModelRuntime }) => ModelRuntime.create())
      .catch((error: unknown) => {
        this.runtime = undefined
        throw error
      })
    return this.runtime
  }

  register(): void {
    const handle = (channel: string, action: (...args: unknown[]) => Promise<unknown>): void => {
      ipcMain.handle(channel, (event, ...args: unknown[]) => {
        if (
          this.disposed ||
          event.sender !== this.window.webContents ||
          event.senderFrame !== this.window.webContents.mainFrame
        )
          throw new Error('无效的请求来源')
        return action(...args)
      })
    }

    handle(piAuthChannels.get, () => this.auth.get())
    handle(piAuthChannels.login, (providerId, type) => this.auth.login(providerId, type))
    handle(piAuthChannels.respond, async (id, value) => this.auth.respond(id, value))
    handle(piAuthChannels.cancel, () => this.auth.cancel())
    handle(piAuthChannels.openLink, (url) => this.auth.openLink(url))
    handle(piChannels.connect, (restart) => this.connect(restart === true))
    handle(piChannels.prompt, async (key, message) => {
      const session = this.session(key)
      await this.requireWorkspace(session.snapshot.cwd)
      await session.prompt(promptText(message))
    })
    handle(piChannels.compact, async (key, instructions) => {
      if (
        instructions !== undefined &&
        (typeof instructions !== 'string' || instructions.length > 100_000)
      )
        throw new Error('压缩要求不能超过 100000 个字符')
      const session = this.session(key)
      await this.requireWorkspace(session.snapshot.cwd)
      await session.compact(
        typeof instructions === 'string' ? instructions.trim() || undefined : undefined
      )
    })
    handle(piChannels.editMessage, async (target, message) => {
      const session = this.messageSession(target)
      await this.requireWorkspace(session.snapshot.cwd)
      await session.editMessage(target, promptText(message))
    })
    handle(piChannels.forkMessage, async (target) => {
      const session = this.messageSession(target)
      const wasCurrent = this.current === session
      await session.exclusive(async () => {
        await this.requireWorkspace(session.snapshot.cwd)
        const { path, entryId } = session.messageTarget(target)
        const copiedPath = await copySessionThrough(path, entryId)
        const fork = await this.createSession(session.snapshot.cwd, copiedPath)
        // 用户已经切走时，分叉完成不能抢走当前视图。
        if (wasCurrent && this.current === session) this.current = fork
        this.publish(true)
      })
    })
    handle(piChannels.abort, async (key) => this.session(key).abort())
    handle(piChannels.respondToToolApproval, async (key, id, approved) => {
      const session = this.session(key)
      if (approved === true) await this.requireWorkspace(session.snapshot.cwd)
      session.respondToToolApproval(id, approved)
    })
    handle(piChannels.respondToUserQuestion, async (key, id, answers) => {
      const session = this.session(key)
      await this.requireWorkspace(session.snapshot.cwd)
      session.respondToUserQuestion(id, answers)
    })
    handle(piChannels.getLibrary, async () => {
      const library = await this.library.load(this.libraryVersion)
      for (const session of library.sessions) {
        if (session.cwd) this.workspacePaths.add(session.cwd)
      }
      await this.refreshWorkspaces()
      return library
    })
    handle(piChannels.getSettings, () => this.settings.get())
    handle(piChannels.getSkills, async (key) => {
      const session = this.session(key)
      await this.requireWorkspace(session.snapshot.cwd)
      return session.getSkills()
    })
    handle(piChannels.saveSettings, async (changes) => {
      const result = await this.settings.save(changes)
      const directory = result.values.sessionDir
      for (const session of this.sessions.values()) {
        if (typeof directory === 'string' && directory) {
          this.library.addSessionDirectory(
            resolve(session.snapshot.cwd, directory.replace(/^~(?=$|[\\/])/, homedir()))
          )
        }
        session.invalidateSettings()
      }
      this.publish(true)
      return result
    })
    handle(piChannels.readImage, (source) => readLocalImage(source, this.active().snapshot.cwd))
    handle(piChannels.openSession, (path) =>
      this.navigate(async () => {
        if (typeof path !== 'string') throw new Error('请选择有效的历史会话')
        const existing = this.findSession(path)
        if (existing) {
          await this.checkWorkspace(existing.snapshot.cwd)
          this.current = existing
        } else {
          const saved = await this.library.findSession(path)
          this.current = await this.createSession(
            saved.cwd || this.active().snapshot.cwd,
            saved.path
          )
        }
        this.publish()
      })
    )
    handle(piChannels.newSession, (cwd) =>
      this.navigate(async () => {
        if (cwd !== undefined && typeof cwd !== 'string') throw new Error('无效的工作目录')
        const directory = typeof cwd === 'string' ? cwd : this.active().snapshot.cwd
        if (
          directory !== this.active().snapshot.cwd &&
          ![...this.sessions.values()].some((session) => session.snapshot.cwd === directory) &&
          !(await this.library.hasWorkspace(directory))
        )
          throw new Error('请选择已有工作目录')
        await this.newSession(directory)
      })
    )
    handle(piChannels.deleteSession, (path) =>
      this.navigate(async () => {
        if (typeof path !== 'string') throw new Error('请选择有效的历史会话')
        const session = this.findSession(path)
        if (session?.busy) throw new Error('请先停止当前操作')
        const savedPath = session
          ? session.persistedFile
          : (await this.library.findSession(path)).path
        try {
          await session?.dispose()
          if (savedPath) await shell.trashItem(resolve(savedPath))
        } catch (error) {
          // 删除失败的会话仍可通过历史重新加载。
          if (session) {
            this.sessions.delete(session.key)
            if (this.current === session) {
              this.current = await this.createSession(session.snapshot.cwd, savedPath)
            }
          }
          this.publish(true)
          throw error
        }
        if (session) {
          this.sessions.delete(session.key)
          if (this.current === session) {
            this.current = await this.createSession(session.snapshot.cwd)
          }
        }
        this.publish(true)
      })
    )
    handle(piChannels.setThinkingLevel, async (key, level) => {
      if (typeof level !== 'string') throw new Error('当前模型不支持该思考强度')
      const session = this.session(key)
      await this.requireWorkspace(session.snapshot.cwd)
      await session.setThinkingLevel(level as PiThinkingLevel)
    })
    handle(piChannels.setModel, async (key, provider, id) => {
      if (typeof provider !== 'string' || typeof id !== 'string')
        throw new Error('请选择可用的模型')
      const session = this.session(key)
      await this.requireWorkspace(session.snapshot.cwd)
      await session.setModel(provider, id)
    })
    handle(piChannels.chooseDirectory, async (language) => {
      if (language !== undefined && language !== 'zh-CN' && language !== 'en') {
        throw new Error('无效的界面语言')
      }
      const result = await dialog.showOpenDialog(this.window, {
        title: language === 'en' ? 'Choose workspace' : '选择工作目录',
        defaultPath: this.active().snapshot.cwd,
        properties: ['openDirectory']
      })
      if (result.canceled || !result.filePaths[0]) return
      await this.navigate(() => this.newSession(result.filePaths[0]))
      return result.filePaths[0]
    })
    this.workspaceTimer = setInterval(() => void this.refreshWorkspaces(), 5000)
    this.window.on('focus', this.refreshWorkspaces)
  }

  private async checkWorkspace(cwd: string): Promise<boolean> {
    this.workspacePaths.add(cwd)
    const available = await stat(cwd).then(
      (info) => info.isDirectory(),
      () => false
    )
    if (this.disposed) return available
    const wasAvailable = !this.unavailableWorkspaces.has(cwd)
    if (available !== wasAvailable) {
      if (available) this.unavailableWorkspaces.delete(cwd)
      else this.unavailableWorkspaces.add(cwd)
      this.publish()
    }
    return available
  }

  private refreshWorkspaces = (): Promise<void> => {
    if (this.disposed) return Promise.resolve()
    // 只检查目录状态，避免轮询时反复扫描会话文件和用量记录。
    this.checkingWorkspaces ??= Promise.all(
      [...this.workspacePaths].map((cwd) => this.checkWorkspace(cwd))
    )
      .then(() => {})
      .finally(() => {
        this.checkingWorkspaces = undefined
      })
    return this.checkingWorkspaces
  }

  private async requireWorkspace(cwd: string): Promise<void> {
    if (!(await this.checkWorkspace(cwd))) throw new Error('工作目录不存在或无法访问')
  }

  private active(): PiSession {
    if (!this.current || this.disposed) throw new Error('本机服务尚未连接，请重新连接')
    return this.current
  }

  private session(key: unknown): PiSession {
    const session = typeof key === 'string' ? this.sessions.get(key) : undefined
    if (!session || this.disposed) throw new Error('会话已变化，请重新选择消息')
    return session
  }

  private messageSession(target: unknown): PiSession {
    if (!target || typeof target !== 'object') throw new Error('无效的消息位置')
    const id = (target as Record<string, unknown>).sessionId
    const session = [...this.sessions.values()].find(
      (session) => session.snapshot.session?.sessionId === id
    )
    if (!session) throw new Error('会话已变化，请重新选择消息')
    return session
  }

  private findSession(path: string): PiSession | undefined {
    return [...this.sessions.values()].find(
      (session) =>
        session.key === path ||
        (!!session.snapshot.session?.sessionFile &&
          relative(session.snapshot.session.sessionFile, path) === '')
    )
  }

  private async createSession(cwd: string, path?: string): Promise<PiSession> {
    if (this.disposed) throw new Error('本机服务已关闭')
    const session = new PiSession(
      cwd,
      this.models,
      (libraryChanged) => this.publish(libraryChanged),
      this.approvalMode,
      path
    )
    this.sessions.set(session.key, session)
    try {
      await session.load()
      await this.checkWorkspace(session.snapshot.cwd)
      if (session.sessionDirectory) this.library.addSessionDirectory(session.sessionDirectory)
      if (this.disposed) throw new Error('本机服务已关闭')
      return session
    } catch (error) {
      this.sessions.delete(session.key)
      await session.dispose()
      throw error
    }
  }

  private async newSession(cwd: string): Promise<void> {
    await this.requireWorkspace(cwd)
    const previous = this.current
    this.current = await this.createSession(cwd)
    // 没提交过消息的空白页不需要一直留在会话表中。
    if (previous && !previous.summary && !previous.busy) {
      this.sessions.delete(previous.key)
      await previous.dispose()
    }
    this.publish()
  }

  private navigate(action: () => Promise<void>): Promise<void> {
    const next = this.navigation.then(async () => {
      if (this.disposed) throw new Error('本机服务已关闭')
      await action()
    })
    this.navigation = next.catch(() => {})
    return next
  }

  connect(restart = false): Promise<PiSnapshot> {
    if (this.connecting) return this.connecting
    this.connecting = this.navigate(async () => {
      if (!this.current) {
        await this.newSession(app.isPackaged ? app.getPath('documents') : process.cwd())
      } else if (restart) {
        const session = this.current
        await session.exclusive(async () => {
          await session.stopClient()
          this.runtime = undefined
          await session.load()
        })
      }
    })
      .then(async () => {
        await this.refreshWorkspaces()
        return this.snapshot()
      })
      .finally(() => {
        this.connecting = undefined
      })
    return this.connecting
  }

  private snapshot(): PiSnapshot {
    return {
      ...this.active().snapshot,
      revision: this.revision,
      libraryVersion: this.libraryVersion,
      sessionKey: this.active().key,
      unavailableWorkspaces: [...this.unavailableWorkspaces],
      toolApprovalMode: this.approvalMode(),
      liveSessions: [...this.sessions.values()].flatMap((session) => {
        const summary = session.summary
        return summary ? [summary] : []
      })
    }
  }

  refreshApprovalMode(): void {
    for (const session of this.sessions.values()) session.refreshApprovalMode()
    this.publish()
  }

  private publish(libraryChanged = false): void {
    if (this.disposed) return
    if (libraryChanged) this.libraryVersion++
    this.revision++
    if (this.broadcastTimer) return
    // 后台流只发布其状态，界面正文始终来自当前选中的会话。
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = undefined
      if (this.current && !this.window.isDestroyed() && !this.disposed) {
        this.window.webContents.send(piChannels.snapshot, this.snapshot())
      }
    }, 32)
  }

  dispose(): Promise<void> {
    if (this.disposing) return this.disposing
    this.disposed = true
    clearTimeout(this.broadcastTimer)
    clearInterval(this.workspaceTimer)
    this.window.removeListener('focus', this.refreshWorkspaces)
    for (const channel of Object.values(piChannels)) ipcMain.removeHandler(channel)
    for (const channel of Object.values(piAuthChannels)) ipcMain.removeHandler(channel)
    const sessions = [...this.sessions.values()]
    this.disposing = (async () => {
      // 包括正在启动的进程；每个会话的 dispose 可重复调用并等待同一次清理。
      await Promise.allSettled([
        this.auth.dispose(),
        ...sessions.map((session) => session.dispose())
      ])
      await this.navigation
      this.sessions.clear()
    })()
    return this.disposing
  }
}
