import {
  SessionSeq,
  pluginRecordOf,
  type Session,
  type SessionEvent
} from '@deepseek-ai/dsh-session'
import {
  assistantStreamFirstTokenTime,
  lastAssistantStreamChunk
} from '@deepseek-ai/dsh-llm/assistant-stream'
import type {} from '@deepseek-ai/dsh-tool-executor-ptc/types'
import type {} from '@deepseek-ai/dsh-compaction/types'
import {
  isTrajectoryQuery,
  trajectoryPageSize,
  type TrajectoryKind,
  type TrajectoryPage,
  type TrajectoryRow
} from '../../shared/trajectory'

interface Entry {
  row: TrajectoryRow
  events: number[]
}

function argumentsValue(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

/** Only read bodies for the row the user opens. Do not serialize provider replay envelopes. */
function detail(event: SessionEvent): unknown {
  switch (event.type) {
    case 'assistant/message':
      return {
        content: event.data.message.content,
        usage: event.data.usage,
        finish: lastAssistantStreamChunk(event.data.stream, 'finish')?.reason
      }
    case 'assistant/attempt':
      return {
        finish: lastAssistantStreamChunk(event.data.stream, 'finish')?.reason,
        usage: lastAssistantStreamChunk(event.data.stream, 'usage')?.usage
      }
    case 'tool/call':
      return {
        name: event.data.name,
        callId: event.data.callId,
        arguments: argumentsValue(event.data.arguments)
      }
    case 'tool/result':
      return { content: event.data.message.content, error: event.data.error, meta: event.data.meta }
    default:
      return event.data
  }
}

/** Lazy per-session index. Only row summaries and sequence numbers survive between reads. */
export class TrajectoryIndex {
  private cursor = 0
  private entries: Entry[] = []
  private bySeq = new Map<number, Entry>()
  private turn?: Entry
  private step?: Entry
  private calls = new Map<string, Entry>()
  private compactions = new Map<string, Entry>()

  constructor(private readonly session: Session) {}

  read(query: unknown): TrajectoryPage {
    if (!isTrajectoryQuery(query)) throw new Error('无效的轨迹位置')
    while (this.cursor < this.session.seq) {
      const event = this.session.eventAt(SessionSeq(this.cursor++))
      if (event) this.apply(event)
    }
    const total = this.entries.length
    const offset = Math.min(query.offset ?? Math.max(0, total - trajectoryPageSize), total)
    const page = this.entries.slice(offset, offset + trajectoryPageSize)
    const selected = query.selected === undefined ? undefined : this.bySeq.get(query.selected)
    return {
      rows: page.map(({ row }) => ({ ...row })),
      offset,
      total,
      ...(selected && {
        detail: selected.events.map((seq) => {
          const event = this.session.eventAt(SessionSeq(seq))!
          return { seq, type: event.type, value: detail(event) }
        })
      })
    }
  }

  private add(
    event: SessionEvent,
    kind: TrajectoryKind,
    fields: Partial<TrajectoryRow> = {}
  ): Entry {
    const row: TrajectoryRow = {
      seq: event.seq,
      kind,
      start: event.time,
      turn: this.turn?.row.turn ?? null,
      step: this.step?.row.step ?? null,
      status: 'recorded',
      ...fields
    }
    const entry = { row, events: [Number(event.seq)] }
    this.entries.push(entry)
    this.bySeq.set(row.seq, entry)
    return entry
  }

  private finish(entry: Entry, event: SessionEvent, status: TrajectoryRow['status']): void {
    entry.events.push(event.seq)
    entry.row.end = event.time
    entry.row.status = status
  }

  private apply(event: SessionEvent): void {
    switch (event.type) {
      case 'turn/start':
        this.turn = this.add(event, 'turn', { turn: event.data.turn, step: null, status: 'open' })
        break
      case 'turn/end': {
        const reason = event.data.reason.kind
        if (this.turn)
          this.finish(
            this.turn,
            event,
            reason === 'error' ? 'error' : reason === 'completed' ? 'recorded' : 'interrupted'
          )
        for (const { row } of this.calls.values())
          if (row.status === 'open') row.status = 'interrupted'
        this.calls.clear()
        this.turn = this.step = undefined
        break
      }
      case 'step/start':
        this.step = this.add(event, 'step', { step: event.data.step, status: 'open' })
        break
      case 'step/end':
        if (this.step) this.finish(this.step, event, 'recorded')
        this.step = undefined
        break
      case 'user/message':
        this.add(event, 'user', {
          label: event.data.content.find((b) => b.type === 'text')?.text.slice(0, 96)
        })
        break
      case 'system/message':
      case 'developer/message':
        this.add(event, event.type === 'system/message' ? 'system' : 'developer')
        break
      case 'request/header':
        this.add(event, 'request')
        break
      case 'assistant/message':
      case 'assistant/attempt': {
        const { stream } = event.data
        const first = stream[0]
        const finish = lastAssistantStreamChunk(stream, 'finish')?.reason
        const message = event.type === 'assistant/message' ? event.data : undefined
        this.add(event, message ? 'assistant' : 'attempt', {
          start: first ? (first.type === 'chunk' ? first.time : first.time0) : event.time,
          end: first ? event.time : undefined,
          firstTokenTime: assistantStreamFirstTokenTime(stream),
          usage: message?.usage ?? lastAssistantStreamChunk(stream, 'usage')?.usage,
          label: message?.message.content.find((b) => b.type === 'text')?.text.slice(0, 96),
          status:
            message?.interrupted || finish?.kind === 'aborted'
              ? 'interrupted'
              : finish?.kind === 'error'
                ? 'error'
                : 'recorded'
        })
        break
      }
      case 'tool/call':
        this.calls.set(
          event.data.callId,
          this.add(event, 'tool', { label: event.data.name, status: 'open' })
        )
        break
      case 'tool/result': {
        const entry = this.calls.get(event.data.message.toolCallId)
        if (entry) this.finish(entry, event, event.data.message.isError ? 'error' : 'recorded')
        else
          this.add(event, 'tool', {
            label: event.data.message.toolCallId,
            status: event.data.message.isError ? 'error' : 'recorded'
          })
        break
      }
      case 'tool/ptc-dispatch-start':
      case 'tool/ptc-dispatch': {
        const parent = this.calls.get(event.data.parentCallId)
        const fields = {
          label: event.data.name,
          parentSeq: parent?.row.seq,
          depth: 1 + (parent?.row.depth ?? 0)
        }
        if (event.type === 'tool/ptc-dispatch-start')
          this.calls.set(
            event.data.subCallId,
            this.add(event, 'subtool', { ...fields, status: 'open' })
          )
        else {
          const entry = this.calls.get(event.data.subCallId)
          const status = event.data.isError ? 'error' : 'recorded'
          if (entry) this.finish(entry, event, status)
          else this.add(event, 'subtool', { ...fields, status })
        }
        break
      }
      case 'compaction/start':
        this.compactions.set(
          event.data.compactionId,
          this.add(event, 'compaction', { turn: event.data.turn, status: 'open' })
        )
        break
      case 'compaction/summary': {
        const entry = this.compactions.get(event.data.compactionId)
        if (entry) {
          entry.events.push(event.seq)
          entry.row.usage = event.data.usage
        }
        break
      }
      case 'compaction/end': {
        const entry = this.compactions.get(event.data.compactionId)
        if (entry) this.finish(entry, event, event.data.error ? 'error' : 'recorded')
        this.compactions.delete(event.data.compactionId)
        break
      }
      default: {
        // Legacy imports synthesize these event timestamps while converting the old transcript.
        const record = pluginRecordOf(event)
        if (record?.type === 'plugin:eli/legacy') {
          for (const { row } of this.entries) {
            if (row.seq > (record.data as import('./messages').LegacyTranscript).throughSeq) break
            row.start = null
            delete row.end
            delete row.firstTokenTime
          }
        }
      }
    }
  }
}
