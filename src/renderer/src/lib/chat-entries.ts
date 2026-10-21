import type { PiMessage, PiSnapshot } from '../../../shared/pi'

type AssistantMessage = Extract<PiMessage, { role: 'assistant' }>
export type ToolCall = Extract<AssistantMessage['content'][number], { type: 'toolCall' }>
export type ToolResult = Extract<PiMessage, { role: 'toolResult' }>
export type TracePart =
  | { id: string; type: 'toolCall'; call: ToolCall }
  | { id: string; type: 'thinking'; text: string; pending: boolean }

type ContentGroup =
  | { id: string; kind: 'text'; text: string }
  | { id: string; kind: 'trace'; parts: TracePart[] }
  | { id: string; kind: 'error'; text: string }
  | { id: string; kind: 'aborted' }

export interface ChatEntry {
  id: string
  lastMessageIndex: number
  role: 'user' | 'assistant'
  groups: ContentGroup[]
}

/** 工具结果不打断连续活动；正文、用户消息和错误保持原来的顺序与边界。 */
export function buildChatEntries(
  messages: PiMessage[],
  activeThinking: PiSnapshot['activeThinking'] = null,
  hideThinking = false
): ChatEntry[] {
  const entries: ChatEntry[] = []
  let current: ChatEntry | undefined

  messages.forEach((message, messageIndex) => {
    if (message.role === 'toolResult') return
    if (message.role !== 'assistant' && message.role !== 'user') {
      current = undefined
      return
    }

    if (message.role === 'user' || current?.role !== 'assistant') {
      current = {
        id: String(messageIndex),
        lastMessageIndex: messageIndex,
        role: message.role,
        groups: []
      }
      entries.push(current)
    }
    const entry = current
    entry.lastMessageIndex = messageIndex
    const content =
      typeof message.content === 'string'
        ? [{ type: 'text' as const, text: message.content }]
        : message.content

    content.forEach((part, partIndex) => {
      const id = `${messageIndex}:${partIndex}`
      const previous = entry.groups.at(-1)
      if (part.type === 'text') {
        // 空文本块是流式占位，不应拆开相邻的工具调用。
        if (!part.text.trim()) return
        if (previous?.kind === 'text') previous.text += `\n${part.text}`
        else entry.groups.push({ id, kind: 'text', text: part.text })
      } else if (part.type === 'toolCall' || part.type === 'thinking') {
        const pending =
          activeThinking?.messageIndex === messageIndex && activeThinking.contentIndex === partIndex
        if (part.type === 'thinking' && (hideThinking || (!pending && !part.thinking.trim())))
          return
        const tracePart: TracePart =
          part.type === 'toolCall'
            ? { id: part.id, type: 'toolCall', call: part }
            : {
                id,
                type: 'thinking',
                text: part.thinking,
                pending
              }
        if (previous?.kind === 'trace') previous.parts.push(tracePart)
        else entry.groups.push({ id, kind: 'trace', parts: [tracePart] })
      }
    })

    if (message.role === 'assistant' && message.stopReason === 'error') {
      entry.groups.push({
        id: `${messageIndex}:error`,
        kind: 'error',
        text: message.errorMessage || '回复失败，请重试。'
      })
      current = undefined
    } else if (message.role === 'assistant' && message.stopReason === 'aborted') {
      entry.groups.push({ id: `${messageIndex}:aborted`, kind: 'aborted' })
      current = undefined
    }
  })

  return entries
}
