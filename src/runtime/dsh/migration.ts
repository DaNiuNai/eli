import { createHash } from 'node:crypto'
import { open, readFile } from 'node:fs/promises'
import { basename, dirname, relative, join } from 'node:path'
import { rememberImport } from './import-index'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session-persistence'
import {
  Session,
  SessionId,
  SESSION_FORMAT_VERSION,
  appendPluginRecord,
  type SessionHeader
} from '@deepseek-ai/dsh-session'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import type { AgentMessage, AgentThinkingLevel } from '../../shared/agent-messages'
import { importMessages, legacyTranscript, saveSessionState } from './messages'

interface LegacyEntry {
  type: string
  id?: string
  parentId?: string | null
  timestamp?: string
  message?: AgentMessage
  systemMessage?: Extract<AgentMessage, { role: 'system' }>
  customType?: string
  data?: unknown
  summary?: string
  firstKeptEntryId?: string
  firstKeptEntryIndex?: number
  tokensBefore?: number
  fromId?: string
  thinkingLevel?: AgentThinkingLevel
  provider?: string
  modelId?: string
  name?: string
}

export async function readSessionIdentity(path: string): Promise<string> {
  if (/^session\.v\d+\.jsonl(?:\.zstd)?$/.test(basename(path))) return basename(dirname(path))
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(65536)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const line = buffer
      .subarray(0, bytesRead)
      .toString('utf8')
      .split('\n', 1)[0]
      .replace(/^\uFEFF/, '')
    const header: unknown = JSON.parse(line)
    if (!header || typeof header !== 'object' || !('id' in header) || typeof header.id !== 'string')
      throw new Error('会话文件头无效')
    return header.id
  } finally {
    await handle.close()
  }
}

function entryMessage(entry: LegacyEntry): AgentMessage | undefined {
  const timestamp = new Date(entry.timestamp ?? 0).getTime()
  if (entry.type === 'message') {
    const message = entry.message
    if (!message || !message.role) throw new Error('旧会话消息缺少角色')
    if ('content' in message && message.content == null)
      return { ...message, content: message.role === 'system' ? '' : [] } as AgentMessage
    return message
  }
  if (entry.type === 'compaction')
    return {
      role: 'compactionSummary',
      summary: entry.summary ?? '',
      tokensBefore: entry.tokensBefore ?? 0,
      timestamp
    }
  if (entry.type === 'branch_summary')
    return {
      role: 'branchSummary',
      summary: entry.summary ?? '',
      fromId: entry.fromId ?? null,
      timestamp
    }
  if (entry.type === 'custom_message') {
    const value = entry as LegacyEntry & { content?: string; display?: boolean; details?: unknown }
    return {
      role: 'custom',
      customType: entry.customType ?? 'legacy',
      content: value.content ?? '',
      display: value.display ?? false,
      details: value.details,
      timestamp
    }
  }
  return undefined
}

/** 只读旧日志，完整转换成功后在 dsh 存储中另存；原文件保持可独立恢复。 */
export async function importLegacySession(
  ctx: Context,
  path: string,
  origin?: 'subagent'
): Promise<SessionId> {
  if (/^session\.v\d+\.jsonl(?:\.zstd)?$/.test(basename(path))) {
    const candidate = SessionId(basename(dirname(path)))
    const native = await ctx.sessionPersistence.stat(candidate)
    if (native?.location && relative(path, native.location.path) === '') return candidate
  }
  const raw = await readFile(path, 'utf8')
  const rows: unknown[] = []
  const lines = raw.replace(/^\uFEFF/, '').split(/\r?\n/)
  for (const [lineNumber, line] of lines.entries()) {
    if (!line.trim()) continue
    try {
      rows.push(JSON.parse(line))
    } catch {
      if (rows.length && lineNumber === lines.length - 1 && !raw.endsWith('\n')) break
      throw new Error(`旧会话第 ${lineNumber + 1} 行无法解析，原文件已保留`)
    }
  }
  const header = rows[0] as {
    type?: string
    id?: string
    version?: number
    cwd?: string
    timestamp?: string
    createdAt?: number
  }
  if (!header || header.type !== 'session' || typeof header.id !== 'string')
    throw new Error('会话文件头无效')
  const id = SessionId(header.id)
  if (header.version === SESSION_FORMAT_VERSION && typeof header.createdAt === 'number') {
    const native = await ctx.sessionPersistence.stat(id)
    if (!native?.location || relative(path, native.location.path) !== '')
      throw new Error('此 dsh 会话不在当前 eli 存储中')
    return id
  }
  const version = header.version ?? 1
  if (![1, 2, 3].includes(version)) throw new Error(`不支持的旧会话版本：${version}；原文件未修改`)
  const digest = createHash('sha256').update(raw).digest('hex')
  const existing = await ctx.sessionPersistence.stat(id)
  if (existing) {
    const handle = await ctx.sessionPersistence.open(id, 'read')
    try {
      const migrated = legacyTranscript((await handle.read()).events)
      if (migrated?.digest !== digest)
        throw new Error('旧会话与迁移记录不一致，请保留两份会话文件后检查；原文件未修改')
      await rememberImport(join(ctx.eli.root, 'sessions'), path, id, digest)
      return id
    } finally {
      await handle.close()
    }
  }
  const entries = rows.slice(1) as LegacyEntry[]
  if (version === 1) {
    // v1 的记录按行排列，压缩边界按含文件头的行号引用。生成稳定 ID 便于重试。
    entries.forEach((entry, index) => {
      entry.id = `v1-${index + 1}`
      entry.parentId = index ? `v1-${index}` : null
    })
    for (const entry of entries)
      if (entry.type === 'compaction' && typeof entry.firstKeptEntryIndex === 'number') {
        entry.firstKeptEntryId = entries[entry.firstKeptEntryIndex - 1]?.id
      }
  }
  if (version < 3)
    for (const entry of entries) {
      const message = entry.message as { role?: string } | undefined
      if (message?.role === 'hookMessage') message.role = 'custom'
    }
  const byId = new Map<string, LegacyEntry>()
  for (const entry of entries) {
    if (
      !entry ||
      typeof entry.type !== 'string' ||
      typeof entry.id !== 'string' ||
      byId.has(entry.id)
    )
      throw new Error('旧会话条目或 ID 无效；原文件未修改')
    byId.set(entry.id, entry)
  }
  const branch: LegacyEntry[] = []
  const visited = new Set<string>()
  let leaf = entries.at(-1)
  while (leaf) {
    if (!leaf.id || visited.has(leaf.id)) throw new Error('旧会话分支存在循环')
    visited.add(leaf.id)
    branch.push(leaf)
    if (!leaf.parentId) break
    const parent = byId.get(leaf.parentId)
    if (!parent) throw new Error('旧会话分支缺少父条目')
    leaf = parent
  }
  branch.reverse()
  const createdAt = new Date(header.timestamp ?? 0).getTime()
  if (!Number.isSafeInteger(createdAt) || createdAt < 0 || typeof header.cwd !== 'string')
    throw new Error('旧会话元数据无效')
  const metadata: SessionHeader = {
    id,
    version: SESSION_FORMAT_VERSION,
    createdAt,
    cwd: header.cwd,
    isSeeded: false,
    ...(origin ? { origin } : {})
  }
  const session = Session.create(id, undefined, metadata)
  const compactionIndex = branch.findLastIndex((entry) => entry.type === 'compaction')
  let modelEntries = branch
  if (compactionIndex >= 0) {
    const compaction = branch[compactionIndex]
    const keep = branch.findIndex((entry) => entry.id === compaction.firstKeptEntryId)
    if (keep < 0) throw new Error('旧会话摘要指向不存在的消息')
    modelEntries = [
      compaction,
      ...branch.slice(keep, compactionIndex),
      ...branch.slice(compactionIndex + 1)
    ]
  }
  const transcript = modelEntries.flatMap((entry) => {
    const message = entryMessage(entry)
    const rows = message ? [{ message, id: entry.id! }] : []
    if (entry.type === 'compaction' && entry.systemMessage?.role === 'system')
      rows.unshift({ message: entry.systemMessage, id: `${entry.id}:system` })
    return rows
  })
  const messages = transcript.map(({ message }) => message)
  const entryIds = await importMessages(session, messages, ctx.attachments)
  appendPluginRecord(
    session,
    'plugin:eli/legacy',
    JSON.parse(
      JSON.stringify({
        path,
        digest,
        throughSeq: session.snapshotEvents().length - 1,
        messages,
        entryIds,
        sourceEntryIds: transcript.map(({ id }) => id),
        name: branch.findLast((entry) => entry.type === 'session_info')?.name
      })
    )
  )
  for (const entry of branch)
    if (entry.type === 'custom' && entry.customType && entry.data !== undefined) {
      saveSessionState(session, entry.customType, entry.data)
    }
  const selectedEntry = branch.findLast(
    (entry) => entry.type === 'model_change' || entry.message?.role === 'assistant'
  )
  const selected =
    selectedEntry?.message?.role === 'assistant'
      ? { provider: selectedEntry.message.provider, modelId: selectedEntry.message.model }
      : selectedEntry
  const thinking = branch.findLast((entry) => entry.type === 'thinking_level_change')?.thinkingLevel
  if (selected?.provider && selected.modelId)
    session.append('model/selection', {
      provider: selected.provider,
      model: selected.modelId,
      ...(thinking ? { reasoningEffort: ReasoningEffortId(thinking) } : {})
    })
  const events = session.snapshotEvents()
  const encodedHeader = sessionFormatCatalog.encodeCurrentHeader(
    { ...metadata, delegationDepth: 0 },
    0
  )
  const verifier = sessionFormatCatalog.createRestore(encodedHeader, {
    recovery: 'strict',
    validation: 'current'
  })
  for (const event of events)
    verifier.decodeRow(sessionFormatCatalog.encodeCurrentEvent(JSON.parse(JSON.stringify(event))))
  verifier.finish()
  const destination = await ctx.sessionPersistence.create(metadata)
  try {
    await destination.append(events)
    await destination.flush()
  } finally {
    await destination.close()
  }
  await rememberImport(join(ctx.eli.root, 'sessions'), path, id, digest)
  return id
}
