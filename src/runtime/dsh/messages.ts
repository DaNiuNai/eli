import { readFileSync } from 'node:fs'
import type { AttachmentStore, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import {
  createAssistantMessage,
  createMessage,
  createSystemMessage,
  createUserMessage,
  ToolCallId,
  BlockAssembler,
  expandAssistantStream,
  type ContentBlock,
  type FinishReason,
  type AssistantStreamRecord,
  type ReplayEnvelope,
  type TokenUsage
} from '@deepseek-ai/dsh-llm'
import {
  appendPluginRecord,
  pluginRecordOf,
  type Session,
  type SessionEvent
} from '@deepseek-ai/dsh-session'
import type { AssistantMessage, ImageContent, Model, Api, Usage } from '@earendil-works/pi-ai'
import { calculateCost, getSystemMessageText } from '@earendil-works/pi-ai'
import type { AgentMessage } from '../../shared/agent-messages'
import type { SubagentMessage } from '../../shared/subagents'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'eli-collaboration': { kind: 'eli-collaboration'; form: 'relay' }
    'eli-history': { kind: 'eli-history'; form: 'recall' }
  }
}

export interface LegacyTranscript {
  path: string
  digest: string
  throughSeq: number
  messages: AgentMessage[]
  entryIds: (string | null)[]
  sourceEntryIds?: string[]
  name?: string
}

declare module '@deepseek-ai/dsh-session' {
  interface PluginRecordMap {
    'plugin:eli/legacy': LegacyTranscript
    'plugin:eli/state': { key: string; value: unknown }
    'plugin:eli/collaboration': { messageId: string; text: string; details?: SubagentMessage }
  }
}

export function saveSessionState(session: Session, key: string, value: unknown): void {
  appendPluginRecord(session, 'plugin:eli/state', JSON.parse(JSON.stringify({ key, value })))
}

export function sessionState(session: Session, key: string): unknown {
  for (const event of [...session.snapshotEvents()].reverse()) {
    const record = pluginRecordOf(event)
    if (record?.type !== 'plugin:eli/state') continue
    const data = record.data as { key?: unknown; value?: unknown }
    if (data.key === key) return data.value
  }
  return undefined
}

export function legacyTranscript(events: readonly SessionEvent[]): LegacyTranscript | undefined {
  const event = events.find((event) => pluginRecordOf(event)?.type === 'plugin:eli/legacy')
  return event ? (pluginRecordOf(event)?.data as LegacyTranscript) : undefined
}

export async function toBlocks(
  message: AgentMessage,
  attachments: AttachmentStore
): Promise<ContentBlock[]> {
  if (message.role === 'branchSummary' || message.role === 'compactionSummary')
    return [{ type: 'text', text: message.summary }]
  if (message.role === 'bashExecution')
    return [{ type: 'text', text: `$ ${message.command}\n${message.output}` }]
  const content = message.content
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  const result: ContentBlock[] = []
  for (const block of content) {
    switch (block.type) {
      case 'text':
        result.push({ type: 'text', text: block.text })
        break
      case 'thinking':
        result.push({ type: 'reasoning', text: block.thinking })
        break
      case 'toolCall':
        result.push({
          type: 'tool-call',
          id: ToolCallId(block.id),
          name: block.name,
          arguments: JSON.stringify(block.arguments)
        })
        break
      case 'image': {
        if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(block.mimeType))
          throw new Error(`不支持的旧会话图片：${block.mimeType}`)
        const attachment = await attachments.saveImage({
          data: Buffer.from(block.data, 'base64'),
          mediaType: block.mimeType as ImageMediaType
        })
        result.push({ type: 'image', attachment })
        break
      }
    }
  }
  return result
}

export function finishReason(message: AssistantMessage): FinishReason {
  if (message.stopReason === 'error' || message.stopReason === 'aborted') {
    return {
      kind: message.stopReason,
      failure: {
        code: message.stopReason.toUpperCase(),
        message: message.errorMessage || '旧会话请求未完成'
      }
    }
  }
  return {
    kind:
      message.stopReason === 'toolUse'
        ? 'tool-calls'
        : message.stopReason === 'length'
          ? 'max-tokens'
          : 'stop'
  }
}

function replayState(message: AssistantMessage): ReplayEnvelope {
  return JSON.parse(
    JSON.stringify({
      response: {
        kind: 'pi-ai',
        version: 2,
        api: message.api,
        provider: message.provider,
        model: message.model,
        responseModel: message.responseModel,
        responseId: message.responseId,
        providerThinkingLevel: message.providerThinkingLevel,
        stopReason: message.stopReason
      },
      blocks: message.content.map((block) =>
        block.type === 'thinking'
          ? {
              type: 'reasoning',
              thinkingSignature: block.thinkingSignature,
              redacted: block.redacted
            }
          : block.type === 'toolCall'
            ? {
                type: 'tool-call',
                thoughtSignature: block.thoughtSignature,
                namespace: block.namespace
              }
            : {
                type: 'text',
                textSignature: block.type === 'text' ? block.textSignature : undefined
              }
      )
    })
  )
}

export async function importMessages(
  session: Session,
  messages: readonly AgentMessage[],
  attachments: AttachmentStore
): Promise<string[]> {
  const entryIds: string[] = []
  const pending = new Map<ToolCallId, SessionEvent['seq']>()
  let turn = 0
  let step = 0
  let opened = false
  let hasAssistant = false
  const closeStep = (): boolean => {
    const interrupted = !hasAssistant || pending.size > 0
    for (const [callId, seq] of pending) {
      const text = '旧会话未记录此次工具调用的结果，不能推断是否执行成功。'
      session.append(
        'tool/result',
        {
          turn,
          step,
          message: createMessage({
            role: 'tool',
            toolCallId: callId,
            isError: true,
            content: [{ type: 'text', text }],
            source: { kind: 'tool', callId }
          }),
          error: { name: 'InterruptedTool', code: 'TOOL_OUTCOME_UNKNOWN', reason: text }
        },
        { surfaceOp: 'append', sourceEventSeqs: [seq] }
      )
    }
    pending.clear()
    session.append('step/end', { turn, step })
    hasAssistant = false
    return interrupted
  }
  const close = (): void => {
    if (!opened) return
    const interrupted = closeStep()
    session.append('turn/end', {
      turn,
      reason: { kind: interrupted ? 'interrupted' : 'completed' }
    })
    opened = false
  }
  for (const original of messages) {
    if (original.role === 'bashExecution' && original.excludeFromContext) {
      entryIds.push(
        String(
          appendPluginRecord(session, 'plugin:eli/state', {
            key: 'eli.excluded-shell',
            value: original
          })
        )
      )
      continue
    }
    const content = await toBlocks(original, attachments)
    if (original.role !== 'assistant' && original.role !== 'toolResult') {
      close()
      turn++
      step = 1
      session.append('turn/start', { turn })
      session.append('step/start', { turn, step })
      opened = true
      const entry =
        original.role === 'system'
          ? session.append(
              'system/message',
              { turn, step, message: createSystemMessage(getSystemMessageText(original)) },
              { surfaceOp: 'append' }
            )
          : session.append(
              'user/message',
              createUserMessage({
                content,
                source:
                  original.role === 'user'
                    ? { kind: 'user' }
                    : { kind: 'eli-history', form: 'recall' }
              }),
              { surfaceOp: 'append' }
            )
      entryIds.push(String(entry.seq))
    } else if (original.role === 'assistant') {
      if (!opened) {
        turn++
        step = 1
        session.append('turn/start', { turn })
        session.append('step/start', { turn, step })
        opened = true
      }
      if (hasAssistant) {
        closeStep()
        step++
        session.append('step/start', { turn, step })
      }
      hasAssistant = true
      const replay = replayState(original)
      const message = createAssistantMessage({
        content,
        source: { provider: original.provider, model: original.model, replayState: replay }
      })
      const usage: TokenUsage = {
        inputTokens: original.usage.input,
        outputTokens: original.usage.output,
        cacheReadTokens: original.usage.cacheRead,
        cacheWriteTokens: original.usage.cacheWrite,
        totalTokens: original.usage.totalTokens
      }
      const time = original.timestamp
      const stream = content.flatMap((block, index) => [
        {
          type: 'chunk' as const,
          time,
          chunk: { type: 'block-start' as const, index, blockType: block.type }
        },
        { type: 'chunk' as const, time, chunk: { type: 'block-end' as const, index, block } }
      ])
      const reason = finishReason(original)
      const settled: AssistantStreamRecord[] = [
        ...stream,
        { type: 'chunk', time, chunk: { type: 'usage', usage } },
        {
          type: 'chunk',
          time,
          chunk: {
            type: 'finish',
            reason,
            ...(reason.kind === 'error' || reason.kind === 'aborted' ? {} : { replayState: replay })
          }
        }
      ]
      if (reason.kind === 'error' || reason.kind === 'aborted') {
        entryIds.push(
          String(session.append('assistant/attempt', { turn, step, stream: settled }).seq)
        )
        session.append('step/end', { turn, step })
        session.append('turn/end', {
          turn,
          reason:
            reason.kind === 'error'
              ? { kind: 'error', error: reason.failure }
              : { kind: 'aborted', reason: { kind: 'legacy' } }
        })
        opened = false
        hasAssistant = false
        continue
      }
      const appended = session.append(
        'assistant/message',
        { turn, step, message, usage, stream: settled },
        { surfaceOp: 'append' }
      )
      entryIds.push(String(appended.seq))
      for (const block of content)
        if (block.type === 'tool-call') {
          pending.set(
            block.id,
            session.append('tool/call', {
              turn,
              step,
              callId: block.id,
              name: block.name,
              arguments: block.arguments
            }).seq
          )
        }
    } else {
      const callId = ToolCallId(original.toolCallId)
      const seq = pending.get(callId)
      const result = session.append(
        'tool/result',
        {
          turn,
          step,
          message: createMessage({
            role: 'tool',
            content,
            source: { kind: 'tool', callId },
            toolCallId: callId,
            isError: original.isError
          }),
          ...(original.details === undefined
            ? {}
            : { meta: JSON.parse(JSON.stringify(original.details)) })
        },
        { surfaceOp: 'append', ...(seq === undefined ? {} : { sourceEventSeqs: [seq] }) }
      )
      entryIds.push(String(result.seq))
      pending.delete(callId)
    }
  }
  close()
  return entryIds
}

function uiImage(
  block: Extract<ContentBlock, { type: 'image' }>,
  attachments: AttachmentStore
): ImageContent | undefined {
  const path = attachments.imageHostPath(block.attachment)
  if (!path) return undefined
  return {
    type: 'image',
    data: readFileSync(path).toString('base64'),
    mimeType: block.attachment.mediaType
  }
}

export function assistantView(
  content: readonly ContentBlock[],
  source: { provider: string; model: string },
  time: number,
  model?: Model<Api>,
  usage?: TokenUsage,
  reason?: FinishReason
): AssistantMessage {
  const tokens: Usage = {
    input: usage?.inputTokens ?? 0,
    output: usage?.outputTokens ?? 0,
    cacheRead: usage?.cacheReadTokens ?? 0,
    cacheWrite: usage?.cacheWriteTokens ?? 0,
    totalTokens:
      usage?.totalTokens ??
      (usage
        ? usage.inputTokens +
          usage.outputTokens +
          (usage.cacheReadTokens ?? 0) +
          (usage.cacheWriteTokens ?? 0)
        : 0),
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  }
  if (model) tokens.cost = calculateCost(model, tokens)
  return {
    role: 'assistant',
    api: model?.api ?? 'openai-completions',
    provider: source.provider,
    model: source.model,
    timestamp: time,
    content: content.flatMap((block): AssistantMessage['content'] => {
      if (block.type === 'text') return [{ type: 'text', text: block.text }]
      if (block.type === 'reasoning') return [{ type: 'thinking', thinking: block.text }]
      if (block.type === 'tool-call') {
        let args: Extract<AssistantMessage['content'][number], { type: 'toolCall' }>['arguments'] =
          {}
        try {
          args = JSON.parse(block.arguments)
        } catch {
          /* 流式参数尚未完整。 */
        }
        return [{ type: 'toolCall', id: block.id, name: block.name, arguments: args }]
      }
      return []
    }),
    usage: tokens,
    stopReason:
      reason?.kind === 'tool-calls'
        ? 'toolUse'
        : reason?.kind === 'max-tokens'
          ? 'length'
          : reason?.kind === 'error' || reason?.kind === 'aborted'
            ? reason.kind
            : 'stop',
    ...(reason?.kind === 'error' || reason?.kind === 'aborted'
      ? { errorMessage: reason.failure.message }
      : {})
  }
}

export function projectTranscript(
  events: readonly SessionEvent[],
  attachments: AttachmentStore,
  getModel: (provider: string, model: string) => Model<Api> | undefined
): { messages: AgentMessage[]; entryIds: (string | null)[] } {
  const legacy = legacyTranscript(events)
  const branchRecord = [...events]
    .reverse()
    .map(pluginRecordOf)
    .find(
      (record) =>
        record?.type === 'plugin:eli/state' &&
        (record.data as { key?: string })?.key === 'eli.branch'
    )
  const branch = (branchRecord?.data as { value?: LegacyTranscript } | undefined)?.value
  const history = branch ?? legacy
  if (
    history &&
    (!Array.isArray(history.messages) ||
      !Array.isArray(history.entryIds) ||
      !Number.isSafeInteger(history.throughSeq))
  )
    throw new Error('eli 会话投影记录无效')
  const messages: AgentMessage[] = history ? structuredClone(history.messages) : []
  const entryIds: (string | null)[] = history ? [...history.entryIds] : []
  const tools = new Map<string, string>()
  let selection = { provider: '', model: '' }
  for (const event of events) {
    if (event.type === 'request/header')
      selection = {
        provider: event.data.header.config.provider,
        model: event.data.header.config.model
      }
    if (event.type === 'tool/call') tools.set(event.data.callId, event.data.name)
    if (history && event.seq <= history.throughSeq) continue
    let message: AgentMessage | undefined
    const record = pluginRecordOf(event)
    if (record?.type === 'plugin:eli/collaboration') {
      const data = record.data as { text: string; details?: SubagentMessage }
      message = {
        role: 'custom',
        customType: 'eli.collaboration',
        content: data.text,
        details: data.details,
        display: true,
        timestamp: event.time
      }
    } else if (
      event.type === 'user/message' &&
      event.surfaceOp === 'append' &&
      event.data.source.kind !== 'eli-collaboration'
    ) {
      message = {
        role: 'user',
        content: event.data.content.flatMap(
          (block): ({ type: 'text'; text: string } | ImageContent)[] => {
            if (block.type === 'text') return [block]
            if (block.type === 'image') {
              const image = uiImage(block, attachments)
              return image ? [image] : []
            }
            return []
          }
        ),
        timestamp: event.time
      }
    } else if (event.type === 'assistant/message' && event.surfaceOp === 'append') {
      const { message: value, usage, stream } = event.data
      const finish = stream.findLast(
        (record) => record.type === 'chunk' && record.chunk.type === 'finish'
      )
      const reason =
        finish?.type === 'chunk' && finish.chunk.type === 'finish' ? finish.chunk.reason : undefined
      message = assistantView(
        value.content,
        value.source,
        event.time,
        getModel(value.source.provider, value.source.model),
        usage,
        reason
      )
    } else if (event.type === 'assistant/attempt') {
      const assembler = new BlockAssembler()
      for (const { chunk } of expandAssistantStream(event.data.stream)) assembler.push(chunk)
      message = assistantView(
        assembler.interruptedBlocks(),
        selection,
        event.time,
        getModel(selection.provider, selection.model),
        assembler.usage,
        assembler.finish
      )
    } else if (event.type === 'tool/result' && event.surfaceOp === 'append') {
      const value = event.data.message
      message = {
        role: 'toolResult',
        toolCallId: value.toolCallId,
        toolName: tools.get(value.toolCallId) ?? '',
        content: value.content.flatMap(
          (block): ({ type: 'text'; text: string } | ImageContent)[] => {
            if (block.type === 'text') return [block]
            if (block.type === 'image') {
              const image = uiImage(block, attachments)
              return image ? [image] : []
            }
            return []
          }
        ),
        details: event.data.meta,
        isError: value.isError ?? false,
        timestamp: event.time
      }
    }
    if (message) {
      messages.push(message)
      entryIds.push(String(event.seq))
    }
  }
  return { messages, entryIds }
}
