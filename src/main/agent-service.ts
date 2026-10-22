import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { relative, resolve } from 'node:path'
import { stat } from 'node:fs/promises'
import { agentChannels, type AgentSnapshot, type AgentThinkingLevel } from '../shared/agent'
import { SessionProcess } from './session-process'
import { startRuntimeProcess } from './runtime-process'
import { runtimePaths } from '../runtime/paths'
import type { RuntimeConnection } from '../runtime/connection'
import type { RuntimeMethod, RuntimeMethods } from '../shared/runtime'
import { readLocalImage, resolvePromptImages, saveImageData } from './image-files'
import { formatChatImageMessage } from '../shared/chat-images'
import { agentAuthChannels } from '../shared/agent-auth'
import type { AgentAuthSnapshot } from '../shared/agent-auth'
import type { ToolApprovalMode } from '../shared/tool-approval'
import type { TerminalPreference } from '../shared/terminal'
import { resolveTerminal } from './terminal'
import { providersChannels } from '../shared/providers'

function promptText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 100_000) {
    throw new Error('请输入 1 至 100000 个字符的消息')
  }
  return value.trim()
}

/** 主进程只切换当前视图；每个会话的进程、锁和事件流均独立维护。 */
export class AgentService {
  private control?: RuntimeConnection
  private controlStart?: Promise<RuntimeConnection>
  private authSnapshot?: AgentAuthSnapshot
  private authRevision = 0
  private readonly root = runtimePaths().root
  private sessions = new Map<string, SessionProcess>()
  private current?: SessionProcess
  private connecting?: Promise<AgentSnapshot>
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
    private readonly firstLaunch = false,
    private readonly approvalMode: () => ToolApprovalMode = () => 'request',
    private readonly terminal: () => TerminalPreference | null = () => null
  ) {}

  private controller(): Promise<RuntimeConnection> {
    if (this.controlStart) return this.controlStart
    this.controlStart = (async () => {
      if (this.disposed) throw new Error('本机服务已关闭')
      const client = startRuntimeProcess(
        (message) => {
          if (this.disposed || this.window.isDestroyed()) return
          if (message.kind === 'auth') this.publishAuth(message.snapshot)
          if (message.kind === 'providers_changed') {
            this.window.webContents.send(providersChannels.changed)
            void this.navigate(async () => {
              await Promise.all(
                [...this.sessions.values()].map((session) => session.refreshProviders())
              )
              this.publish()
            }).catch((error: unknown) => {
              if (this.current) this.current.snapshot.error = String(error)
              this.publish()
            })
          }
        },
        (error) => {
          if (this.control !== client) return
          this.controlStart = undefined
          this.control = undefined
          if (this.authSnapshot)
            this.publishAuth({
              ...this.authSnapshot,
              status: 'error',
              error: error.message,
              prompt: undefined,
              notice: undefined
            })
          if (this.current && !this.disposed) {
            this.current.snapshot.error = error.message
            this.publish()
          }
        }
      )
      this.control = client
      try {
        await client.call('initialize', {
          kind: 'control',
          root: this.root,
          cwd: process.cwd(),
          firstLaunch: this.firstLaunch
        })
      } catch (error) {
        await client.stop()
        if (this.control === client) this.control = undefined
        throw error
      }
      return client
    })().catch((error: unknown) => {
      this.controlStart = undefined
      throw error
    })
    return this.controlStart
  }

  private async request<K extends RuntimeMethod>(
    method: K,
    ...args: unknown[]
  ): Promise<RuntimeMethods[K]['result']> {
    return (await this.controller()).call(method, ...(args as RuntimeMethods[K]['args']))
  }

  private publishAuth(snapshot: AgentAuthSnapshot): AgentAuthSnapshot {
    // 管理进程可以重启，界面的 revision 必须保持单调递增。
    this.authSnapshot = { ...snapshot, revision: ++this.authRevision }
    if (!this.disposed && !this.window.isDestroyed())
      this.window.webContents.send(agentAuthChannels.snapshot, this.authSnapshot)
    return this.authSnapshot
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

    handle(agentAuthChannels.get, async () => this.publishAuth(await this.request('getAuth')))
    handle(providersChannels.get, () => this.request('getProviders'))
    handle(providersChannels.change, (change) => this.request('changeProvider', change))
    handle(agentAuthChannels.login, (providerId, type) => this.request('login', providerId, type))
    handle(agentAuthChannels.respond, async (id, value) => this.request('respondLogin', id, value))
    handle(agentAuthChannels.cancel, () => this.request('cancelLogin'))
    handle(agentAuthChannels.openLink, (url) =>
      this.request('validateAuthLink', url).then((link) => shell.openExternal(link))
    )
    handle(agentChannels.connect, (restart) => this.connect(restart === true))
    handle(agentChannels.prompt, async (key, message, imagePaths = []) => {
      const session = this.session(key)
      await this.requireWorkspace(session.snapshot.cwd)
      if (session.busy) throw new Error('请等待当前操作完成')
      if (typeof message !== 'string' || message.length > 100_000)
        throw new Error('请输入 1 至 100000 个字符的消息')
      if (!Array.isArray(imagePaths)) throw new Error('无效的图片列表')
      if (!message.trim() && !imagePaths.length) throw new Error('请输入消息或添加图片')
      await session.prompt(message, async () => {
        const paths = await resolvePromptImages(imagePaths, session.snapshot.cwd)
        return promptText(formatChatImageMessage(message, paths))
      })
    })
    handle(agentChannels.compact, async (key, instructions) => {
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
    handle(agentChannels.editMessage, async (target, message) => {
      const session = this.messageSession(target)
      await this.requireWorkspace(session.snapshot.cwd)
      await session.editMessage(target, promptText(message))
    })
    handle(agentChannels.forkMessage, async (target) => {
      const session = this.messageSession(target)
      const wasCurrent = this.current === session
      await session.exclusive(async () => {
        await this.requireWorkspace(session.snapshot.cwd)
        const copiedPath = await session.forkMessage(target)
        const fork = await this.createSession(session.snapshot.cwd, copiedPath)
        // 用户已经切走时，分叉完成不能抢走当前视图。
        if (wasCurrent && this.current === session) this.current = fork
        this.publish(true)
      })
    })
    handle(agentChannels.abort, async (key) => this.session(key).abort())
    handle(agentChannels.respondToToolApproval, async (key, id, approved) => {
      const session = this.session(key)
      if (approved === true) await this.requireWorkspace(session.snapshot.cwd)
      await session.respondToToolApproval(id, approved)
    })
    handle(agentChannels.respondToUserQuestion, async (key, id, answers) => {
      const session = this.session(key)
      await this.requireWorkspace(session.snapshot.cwd)
      await session.respondToUserQuestion(id, answers)
    })
    handle(agentChannels.getLibrary, async () => {
      const library = await this.request('getLibrary', this.libraryVersion)
      for (const session of library.sessions) {
        if (session.cwd) this.workspacePaths.add(session.cwd)
      }
      await this.refreshWorkspaces()
      return library
    })
    handle(agentChannels.getSettings, () => this.request('getSettings'))
    handle(agentChannels.getSkills, async (key) => {
      const session = this.session(key)
      await this.requireWorkspace(session.snapshot.cwd)
      return session.getSkills()
    })
    handle(agentChannels.saveSettings, async (changes) => {
      const result = await this.request('saveSettings', changes)
      for (const session of this.sessions.values()) {
        session.invalidateSettings()
      }
      this.publish(true)
      return result
    })
    handle(agentChannels.readImage, (source) => readLocalImage(source, this.active().snapshot.cwd))
    handle(agentChannels.saveImageData, (bytes) => saveImageData(bytes))
    handle(agentChannels.chooseImages, async (language) => {
      if (language !== undefined && language !== 'zh-CN' && language !== 'en')
        throw new Error('无效的界面语言')
      const result = await dialog.showOpenDialog(this.window, {
        title: language === 'en' ? 'Add images' : '添加图片',
        properties: ['openFile', 'multiSelections'],
        filters: [
          {
            name: language === 'en' ? 'Images' : '图片',
            extensions: ['png', 'jpg', 'jpeg', 'jfif', 'webp', 'gif', 'avif', 'bmp', 'ico', 'svg']
          }
        ]
      })
      return result.canceled ? [] : result.filePaths
    })
    handle(agentChannels.openSession, (path) =>
      this.navigate(async () => {
        if (typeof path !== 'string') throw new Error('请选择有效的历史会话')
        const existing = this.findSession(path)
        if (existing) {
          await this.checkWorkspace(existing.snapshot.cwd)
          this.current = existing
        } else {
          const saved = await this.request('findSession', path)
          this.current = await this.createSession(
            saved.cwd || this.active().snapshot.cwd,
            saved.path
          )
        }
        this.publish()
      })
    )
    handle(agentChannels.newSession, (cwd) =>
      this.navigate(async () => {
        if (cwd !== undefined && typeof cwd !== 'string') throw new Error('无效的工作目录')
        const directory = typeof cwd === 'string' ? cwd : this.active().snapshot.cwd
        if (
          directory !== this.active().snapshot.cwd &&
          ![...this.sessions.values()].some((session) => session.snapshot.cwd === directory) &&
          !(await this.request('hasWorkspace', directory))
        )
          throw new Error('请选择已有工作目录')
        await this.newSession(directory)
      })
    )
    handle(agentChannels.deleteSession, (path) =>
      this.navigate(async () => {
        if (typeof path !== 'string') throw new Error('请选择有效的历史会话')
        const session = this.findSession(path)
        if (session?.busy) throw new Error('请先停止当前操作')
        const savedPath = session
          ? session.persistedFile
          : (await this.request('findSession', path)).path
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
    handle(agentChannels.setThinkingLevel, async (key, level) => {
      if (typeof level !== 'string') throw new Error('当前模型不支持该思考强度')
      const session = this.session(key)
      await this.requireWorkspace(session.snapshot.cwd)
      await session.setThinkingLevel(level as AgentThinkingLevel)
    })
    handle(agentChannels.setModel, async (key, provider, id) => {
      if (typeof provider !== 'string' || typeof id !== 'string')
        throw new Error('请选择可用的模型')
      const session = this.session(key)
      await this.requireWorkspace(session.snapshot.cwd)
      await session.setModel(provider, id)
    })
    handle(agentChannels.chooseDirectory, async (language) => {
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

  private active(): SessionProcess {
    if (!this.current || this.disposed) throw new Error('本机服务尚未连接，请重新连接')
    return this.current
  }

  private session(key: unknown): SessionProcess {
    const session = typeof key === 'string' ? this.sessions.get(key) : undefined
    if (!session || this.disposed) throw new Error('会话已变化，请重新选择消息')
    return session
  }

  private messageSession(target: unknown): SessionProcess {
    if (!target || typeof target !== 'object') throw new Error('无效的消息位置')
    const id = (target as Record<string, unknown>).sessionId
    const session = [...this.sessions.values()].find(
      (session) => session.snapshot.session?.sessionId === id
    )
    if (!session) throw new Error('会话已变化，请重新选择消息')
    return session
  }

  private findSession(path: string): SessionProcess | undefined {
    return [...this.sessions.values()].find(
      (session) =>
        session.key === path ||
        (!!session.snapshot.session?.sessionFile &&
          relative(session.snapshot.session.sessionFile, path) === '')
    )
  }

  private async createSession(cwd: string, path?: string): Promise<SessionProcess> {
    if (this.disposed) throw new Error('本机服务已关闭')
    const session = new SessionProcess(
      cwd,
      this.root,
      (libraryChanged) => this.publish(libraryChanged),
      this.approvalMode,
      this.terminal,
      { start: startRuntimeProcess, resolveTerminal },
      path
    )
    this.sessions.set(session.key, session)
    try {
      await session.load()
      await this.checkWorkspace(session.snapshot.cwd)
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

  connect(restart = false): Promise<AgentSnapshot> {
    if (this.connecting) return this.connecting
    this.connecting = this.navigate(async () => {
      if (!this.current) {
        await this.newSession(app.isPackaged ? app.getPath('documents') : process.cwd())
      } else if (restart) {
        const session = this.current
        await session.exclusive(async () => {
          await session.stopClient()
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

  private snapshot(): AgentSnapshot {
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

  refreshTerminal(): void {
    for (const session of this.sessions.values()) session.invalidateSettings()
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
        this.window.webContents.send(agentChannels.snapshot, this.snapshot())
      }
    }, 32)
  }

  dispose(): Promise<void> {
    if (this.disposing) return this.disposing
    this.disposed = true
    clearTimeout(this.broadcastTimer)
    clearInterval(this.workspaceTimer)
    this.window.removeListener('focus', this.refreshWorkspaces)
    for (const channel of Object.values(agentChannels)) ipcMain.removeHandler(channel)
    for (const channel of Object.values(agentAuthChannels)) ipcMain.removeHandler(channel)
    for (const channel of Object.values(providersChannels)) ipcMain.removeHandler(channel)
    const sessions = [...this.sessions.values()]
    this.disposing = (async () => {
      // 包括正在启动的进程；每个会话的 dispose 可重复调用并等待同一次清理。
      await Promise.allSettled([
        this.control?.stop(),
        ...sessions.map((session) => session.dispose())
      ])
      await this.navigation
      this.sessions.clear()
    })()
    return this.disposing
  }
}
