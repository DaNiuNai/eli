import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import type { SessionInfo } from '@earendil-works/pi-coding-agent'
import {
  localDateKey,
  type PiLibrary,
  type SavedSession,
  type UsageRecord
} from '../shared/pi-library'

type UsageEvent = Omit<UsageRecord, 'sessionPath'> & { key: string }
type CachedUsage = { size: number; modified: number; events: UsageEvent[]; incomplete: boolean }

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function amount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

// 只读取官方索引返回的会话文件，流式解析，不向界面传输历史消息正文。
export class PiLibraryService {
  private cache = new Map<string, CachedUsage>()
  private sessions = new Map<string, SavedSession>()
  private loading?: Promise<PiLibrary>
  private loadingVersion = -1

  load(version = 0): Promise<PiLibrary> {
    if (this.loading && version > this.loadingVersion) {
      return this.loading.then(() => this.load(version))
    }
    if (!this.loading) {
      this.loadingVersion = version
      this.loading = this.read().finally(() => {
        this.loading = undefined
      })
    }
    return this.loading
  }

  async findSession(path: string): Promise<SavedSession> {
    if (!this.sessions.has(path)) await this.load()
    const session = this.sessions.get(path)
    if (!session) throw new Error('该会话不在本机 pi 历史记录中，请刷新列表')
    await stat(session.path)
    return session
  }

  async hasWorkspace(cwd: string): Promise<boolean> {
    if (![...this.sessions.values()].some((session) => session.cwd === cwd)) await this.load()
    return [...this.sessions.values()].some((session) => session.cwd === cwd)
  }

  private async readUsage(session: SessionInfo): Promise<CachedUsage> {
    const info = await stat(session.path)
    const cached = this.cache.get(session.path)
    if (cached && cached.size === info.size && cached.modified === info.mtimeMs) return cached
    const events: UsageEvent[] = []
    let incomplete = false
    let provider = ''
    let model = ''
    let lineNumber = 0
    const lines = createInterface({
      input: createReadStream(session.path, { encoding: 'utf8' }),
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
      if (entry.type === 'model_change') {
        provider = typeof entry.provider === 'string' ? entry.provider : ''
        model = typeof entry.modelId === 'string' ? entry.modelId : ''
        continue
      }
      const message = entry.type === 'message' ? object(entry.message) : undefined
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
            : `${session.path}:${lineNumber}`,
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
    const result = { size: info.size, modified: info.mtimeMs, events, incomplete }
    this.cache.set(session.path, result)
    return result
  }

  private async read(): Promise<PiLibrary> {
    const { SessionManager } = await import('@earendil-works/pi-coding-agent')
    const infos = await SessionManager.listAll()
    const saved = infos.map((session): SavedSession => ({
      path: session.path,
      id: session.id,
      cwd: session.cwd,
      title: (session.name || session.firstMessage || '未命名对话')
        .replace(/\s+/g, ' ')
        .slice(0, 160),
      created: session.created.getTime(),
      modified: session.modified.getTime(),
      messageCount: session.messageCount
    }))
    this.sessions = new Map(saved.map((session) => [session.path, session]))
    for (const path of this.cache.keys()) {
      if (!this.sessions.has(path)) this.cache.delete(path)
    }

    const usageByFile = new Map<string, UsageEvent[]>()
    let skipped = 0
    let cursor = 0
    await Promise.all(
      Array.from({ length: Math.min(4, infos.length) }, async () => {
        while (cursor < infos.length) {
          const session = infos[cursor++]
          try {
            const result = await this.readUsage(session)
            usageByFile.set(session.path, result.events)
            if (result.incomplete) skipped++
          } catch {
            skipped++
          }
        }
      })
    )

    const seen = new Set<string>()
    const aggregates = new Map<string, UsageRecord>()
    // 先归属到最早的会话，避免分支继承的 token 重复计入总量。
    for (const session of [...saved].sort((a, b) => a.created - b.created)) {
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
      sessions: saved.sort((a, b) => b.modified - a.modified),
      usage: [...aggregates.values()],
      updatedAt: Date.now(),
      warning: skipped ? `${skipped} 个会话存在无法读取或尚未写完的记录，统计可能暂不完整。` : null
    }
  }
}
