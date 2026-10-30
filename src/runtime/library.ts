import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import {
  localDateKey,
  type AgentLibrary,
  type SavedSession,
  type UsageRecord
} from '../shared/agent-library'

type UsageEvent = Omit<UsageRecord, 'sessionPath'> & { key: string }
type CachedSession = {
  size: number
  modified: number
  session: SavedSession | null
  events: UsageEvent[]
  incomplete: boolean
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function amount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

// 元数据与用量一次流式读取；未变化的会话只检查文件属性，不再解析正文。
export class AgentLibraryService {
  private cache = new Map<string, CachedSession>()
  private sessions = new Map<string, SavedSession>()
  private loading?: Promise<AgentLibrary>
  private loadingVersion = -1
  constructor(private readonly sessionDirectory: string) {}

  load(version = 0): Promise<AgentLibrary> {
    this.loadingVersion = Math.max(this.loadingVersion, version)
    if (!this.loading) {
      this.loading = (async () => {
        for (;;) {
          const current = this.loadingVersion
          const library = await this.read()
          if (current === this.loadingVersion) return library
        }
      })().finally(() => {
        this.loading = undefined
      })
    }
    return this.loading
  }

  async findSession(path: string): Promise<SavedSession> {
    if (!this.sessions.has(path)) await this.load()
    const session = this.sessions.get(path)
    if (!session) throw new Error('该会话不在本机历史记录中，请刷新列表')
    await stat(session.path)
    return session
  }

  async hasWorkspace(cwd: string): Promise<boolean> {
    if (![...this.sessions.values()].some((session) => session.cwd === cwd)) await this.load()
    return [...this.sessions.values()].some((session) => session.cwd === cwd)
  }

  private async readFile(path: string, info: Stats): Promise<CachedSession> {
    const events: UsageEvent[] = []
    let incomplete = false
    let provider = ''
    let model = ''
    let lineNumber = 0
    let header: Record<string, unknown> | undefined
    let title = ''
    let name = ''
    let messageCount = 0
    let lastActivity = 0
    const lines = createInterface({
      input: createReadStream(path, { encoding: 'utf8' }),
      crlfDelay: Infinity
    })
    for await (const line of lines) {
      lineNumber++
      if (!line.trim()) continue
      let entry: Record<string, unknown> | undefined
      try {
        entry = object(JSON.parse(line))
      } catch {
        incomplete = true
        continue
      }
      if (!entry) continue
      if (!header) {
        if (entry.type !== 'session' || typeof entry.id !== 'string') break
        header = entry
        continue
      }
      if (entry.type === 'session_info') {
        name = typeof entry.name === 'string' ? entry.name.trim() : ''
      }
      if (entry.type === 'model_change') {
        provider = typeof entry.provider === 'string' ? entry.provider : ''
        model = typeof entry.modelId === 'string' ? entry.modelId : ''
        continue
      }
      const message = entry.type === 'message' ? object(entry.message) : undefined
      if (entry.type === 'message') {
        messageCount++
        const timestamp =
          typeof message?.timestamp === 'number' ? message.timestamp : entry.timestamp
        const time = new Date(timestamp as string | number).getTime()
        if (Number.isFinite(time)) lastActivity = Math.max(lastActivity, time)
        if (!title && message?.role === 'user') {
          title =
            typeof message.content === 'string'
              ? message.content
              : Array.isArray(message.content)
                ? message.content
                    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
                    .map((part) => part.text)
                    .join(' ')
                : ''
        }
      }
      const usage = object(message?.usage ?? entry.usage)
      const isConversation = message?.role === 'user' || message?.role === 'assistant'
      if (!isConversation && !usage) continue
      const timestamp = typeof message?.timestamp === 'number' ? message.timestamp : entry.timestamp
      if (typeof timestamp !== 'number' && typeof timestamp !== 'string') continue
      const date = new Date(timestamp)
      if (!Number.isFinite(date.getTime())) continue
      const eventProvider =
        typeof message?.provider === 'string'
          ? message.provider
          : typeof entry.provider === 'string'
            ? entry.provider
            : provider
      const eventModel =
        typeof message?.model === 'string'
          ? message.model
          : typeof entry.model === 'string'
            ? entry.model
            : model
      events.push({
        // 分叉/克隆会保留原条目 ID；时间与类型一起参与去重，旧格式按文件和行区分。
        key:
          typeof entry.id === 'string'
            ? JSON.stringify([entry.id, date.getTime(), entry.type, message?.role])
            : `${path}:${lineNumber}`,
        date: localDateKey(date),
        hour: date.getHours(),
        provider: usage ? eventProvider : '',
        model: usage ? eventModel : '',
        messages: isConversation ? 1 : 0,
        requests: message?.role === 'assistant' ? 1 : 0,
        input: amount(usage?.input),
        output: amount(usage?.output),
        cacheRead: amount(usage?.cacheRead),
        cacheWrite: amount(usage?.cacheWrite),
        cost: amount(object(usage?.cost)?.total)
      })
    }
    const created = new Date(header?.timestamp as string).getTime()
    const session: SavedSession | null = header
      ? {
          path,
          id: header.id as string,
          cwd: typeof header.cwd === 'string' ? header.cwd : '',
          title: (name || title || '未命名对话').replace(/\s+/g, ' ').slice(0, 160),
          created: Number.isFinite(created) ? created : info.birthtimeMs,
          modified: lastActivity || (Number.isFinite(created) ? created : info.mtimeMs),
          messageCount
        }
      : null
    const result = { size: info.size, modified: info.mtimeMs, session, events, incomplete }
    this.cache.set(path, result)
    return result
  }

  private async read(): Promise<AgentLibrary> {
    const directories = await readdir(this.sessionDirectory, { withFileTypes: true }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return []
        throw error
      }
    )
    // 只发现顶层及工作目录层的 jsonl，子 Agent 的目录不属于历史会话列表。
    const files = directories
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map((entry) => join(this.sessionDirectory, entry.name))
    for (const directory of directories) {
      if (!directory.isDirectory()) continue
      const path = join(this.sessionDirectory, directory.name)
      const entries = await readdir(path, { withFileTypes: true }).catch(() => [])
      files.push(
        ...entries
          .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
          .map((entry) => join(path, entry.name))
      )
    }
    const present = new Set(files)
    for (const path of this.cache.keys()) if (!present.has(path)) this.cache.delete(path)
    const saved: SavedSession[] = []
    const usageByFile = new Map<string, UsageEvent[]>()
    let skipped = 0
    let cursor = 0
    await Promise.all(
      Array.from({ length: Math.min(4, files.length) }, async () => {
        while (cursor < files.length) {
          const path = files[cursor++]
          try {
            const info = await stat(path)
            const cached = this.cache.get(path)
            const result =
              cached && cached.size === info.size && cached.modified === info.mtimeMs
                ? cached
                : await this.readFile(path, info)
            if (!result.session) continue
            saved.push(result.session)
            usageByFile.set(path, result.events)
            if (result.incomplete) skipped++
          } catch {
            skipped++
          }
        }
      })
    )
    this.sessions = new Map(saved.map((session) => [session.path, session]))

    const seen = new Set<string>()
    const aggregates = new Map<string, UsageRecord>()
    // 先归属到最早的会话，避免分支继承的 token 重复计入总量。
    for (const session of [...saved].sort(
      (a, b) => a.created - b.created || a.path.localeCompare(b.path)
    )) {
      for (const event of usageByFile.get(session.path) ?? []) {
        if (seen.has(event.key)) continue
        seen.add(event.key)
        const key = JSON.stringify([
          session.path,
          event.date,
          event.hour,
          event.provider,
          event.model
        ])
        const record = aggregates.get(key)
        if (record) {
          record.messages += event.messages
          record.requests += event.requests
          record.input += event.input
          record.output += event.output
          record.cacheRead += event.cacheRead
          record.cacheWrite += event.cacheWrite
          record.cost += event.cost
        } else {
          aggregates.set(key, {
            sessionPath: session.path,
            date: event.date,
            hour: event.hour,
            provider: event.provider,
            model: event.model,
            messages: event.messages,
            requests: event.requests,
            input: event.input,
            output: event.output,
            cacheRead: event.cacheRead,
            cacheWrite: event.cacheWrite,
            cost: event.cost
          })
        }
      }
    }
    return {
      sessions: saved.sort((a, b) => b.modified - a.modified || a.path.localeCompare(b.path)),
      usage: [...aggregates.values()],
      updatedAt: Date.now(),
      warning: skipped ? `${skipped} 个会话存在无法读取或尚未写完的记录，统计可能暂不完整。` : null
    }
  }
}
