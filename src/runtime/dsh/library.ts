import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import { pluginRecordOf, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { AgentMessage } from '../../shared/agent-messages'
import { localDateKey, type SavedSession, type UsageRecord } from '../../shared/agent-library'
import { legacyTranscript } from './messages'

export type DshUsageEvent = Omit<UsageRecord, 'sessionPath'> & {
  key: string
  timestamp: number
  stopReason: string
}
export interface DshLibraryEntry {
  session: SavedSession
  events: DshUsageEvent[]
  legacyPath?: string
  legacyEventCount: number
}
export type DshLibraryCache = Map<string, { revision: string; entry: DshLibraryEntry | null }>

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join(' ')
}

function usageEvent(
  message: AgentMessage,
  id: string,
  fallbackTime: number
): DshUsageEvent | undefined {
  if (message.role !== 'assistant' && message.role !== 'user') return undefined
  const timestamp = message.timestamp ?? fallbackTime
  const date = new Date(timestamp)
  const usage = message.role === 'assistant' ? message.usage : undefined
  return {
    key: JSON.stringify([id, timestamp, 'message', message.role]),
    timestamp,
    stopReason: message.role === 'assistant' ? message.stopReason : 'unknown',
    date: localDateKey(date),
    hour: date.getHours(),
    provider: message.role === 'assistant' ? message.provider : '',
    model: message.role === 'assistant' ? message.model : '',
    messages: 1,
    requests: message.role === 'assistant' ? 1 : 0,
    input: usage?.input ?? 0,
    output: usage?.output ?? 0,
    cacheRead: usage?.cacheRead ?? 0,
    cacheWrite: usage?.cacheWrite ?? 0,
    cost: usage?.cost.total ?? 0
  }
}

function stateValues(events: readonly SessionEvent[]): Map<string, unknown> {
  const values = new Map<string, unknown>()
  for (const event of events) {
    const record = pluginRecordOf(event)
    if (record?.type !== 'plugin:eli/state') continue
    const data = record.data as { key?: string; value?: unknown }
    if (typeof data.key === 'string') values.set(data.key, data.value)
  }
  return values
}

export async function readDshLibrary(
  persistence: SessionPersistence,
  cache: DshLibraryCache
): Promise<{ entries: DshLibraryEntry[]; skipped: number }> {
  const entries: DshLibraryEntry[] = []
  let skipped = 0
  const snapshots = await persistence.list()
  const present = new Set<string>(snapshots.map(({ header }) => header.id))
  for (const id of cache.keys()) if (!present.has(id)) cache.delete(id)
  for (const stored of snapshots) {
    if (!stored.location?.path || stored.header.origin === 'subagent') continue
    const cached = cache.get(stored.header.id)
    const revision = String(stored.revision)
    if (cached && cached.revision === revision) {
      if (cached.entry) entries.push(cached.entry)
      continue
    }
    let handle: Awaited<ReturnType<SessionPersistence['open']>> | undefined
    try {
      handle = await persistence.open(stored.header.id, 'read')
      const log = (await handle.read()).events
      const state = stateValues(log)
      const legacy = legacyTranscript(log)
      const usage: DshUsageEvent[] = []
      let title = ''
      let messageCount = 0
      let modified = stored.header.createdAt
      if (legacy) {
        messageCount = legacy.messages.length
        legacy.messages.forEach((message, index) => {
          if (!title && message.role === 'user') title = textOf(message.content)
          const event = usageEvent(
            message,
            legacy.sourceEntryIds?.[index] ?? legacy.entryIds[index] ?? String(index),
            stored.header.createdAt
          )
          if (event) {
            usage.push(event)
            modified = Math.max(modified, event.timestamp)
          }
        })
      }
      const legacyEventCount = usage.length
      for (const event of log) {
        if (legacy && event.seq <= legacy.throughSeq) continue
        const record = pluginRecordOf(event)
        if (record?.type === 'plugin:eli/cache-warm') {
          const value =
            record.data as import('@deepseek-ai/dsh-session').PluginRecordMap['plugin:eli/cache-warm']
          const date = new Date(event.time)
          usage.push({
            key: JSON.stringify(['cache-warm', event.time, event.seq, value.provider, value.model]),
            timestamp: event.time,
            stopReason: 'cache_warm',
            date: localDateKey(date),
            hour: date.getHours(),
            provider: value.provider,
            model: value.model,
            messages: 0,
            requests: 0,
            input: value.usage.inputTokens,
            output: value.usage.outputTokens,
            cacheRead: value.usage.cacheReadTokens ?? 0,
            cacheWrite: value.usage.cacheWriteTokens ?? 0,
            cost: value.cost
          })
        }
        if (event.type === 'user/message' && event.surfaceOp === 'append') {
          messageCount++
          title ||= textOf(event.data.content)
          const date = new Date(event.time)
          usage.push({
            key: JSON.stringify([event.data.id, event.time, 'message', 'user']),
            timestamp: event.time,
            stopReason: 'unknown',
            date: localDateKey(date),
            hour: date.getHours(),
            provider: '',
            model: '',
            messages: 1,
            requests: 0,
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            cost: 0
          })
          modified = Math.max(modified, event.time)
        }
        if (event.type === 'assistant/message' && event.surfaceOp === 'append') {
          messageCount++
          const date = new Date(event.time)
          const value = event.data.usage
          const cost = state.get(`eli.usage:${event.seq}`) as { cost?: number } | undefined
          const finish = event.data.stream.findLast(
            (part) => part.type === 'chunk' && part.chunk.type === 'finish'
          )
          const reason =
            finish?.type === 'chunk' && finish.chunk.type === 'finish'
              ? finish.chunk.reason.kind
              : 'stop'
          usage.push({
            key: JSON.stringify([event.data.message.id, event.time, 'message', 'assistant']),
            timestamp: event.time,
            stopReason:
              reason === 'tool-calls' ? 'toolUse' : reason === 'max-tokens' ? 'length' : reason,
            date: localDateKey(date),
            hour: date.getHours(),
            provider: event.data.message.source.provider,
            model: event.data.message.source.model,
            messages: 1,
            requests: 1,
            input: value?.inputTokens ?? 0,
            output: value?.outputTokens ?? 0,
            cacheRead: value?.cacheReadTokens ?? 0,
            cacheWrite: value?.cacheWriteTokens ?? 0,
            cost: cost?.cost ?? 0
          })
          modified = Math.max(modified, event.time)
        }
        if (event.type === 'tool/result' && event.surfaceOp === 'append') messageCount++
      }
      if (!messageCount) {
        cache.set(stored.header.id, { revision, entry: null })
        continue
      }
      const entry = {
        session: {
          path: stored.location.path,
          id: stored.header.id,
          cwd: stored.header.cwd ?? '',
          title: String(state.get('eli.title') ?? legacy?.name ?? (title || '未命名对话'))
            .replace(/\s+/g, ' ')
            .slice(0, 160),
          created: stored.header.createdAt,
          modified,
          messageCount
        },
        events: usage,
        legacyPath: stored.header.isSeeded ? undefined : legacy?.path,
        legacyEventCount
      }
      entries.push(entry)
      cache.set(stored.header.id, { revision, entry })
    } catch {
      skipped++
    } finally {
      await handle?.close()
    }
  }
  return { entries, skipped }
}
