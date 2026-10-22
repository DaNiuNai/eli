import type { JsonAgentSessionEvent } from '@earendil-works/pi-coding-agent'
import type { PiMessage, PiResponsePhase, PiResponseState, PiSnapshot } from './pi'

type MessageUpdate = Extract<JsonAgentSessionEvent, { type: 'message_update' }>

export function updateResponsePhase(
  current: PiResponsePhase,
  event: MessageUpdate
): PiResponsePhase {
  switch (event.assistantMessageEvent.type) {
    case 'thinking_start':
    case 'thinking_delta':
      return 'thinking'
    case 'text_start':
    case 'text_delta':
      return 'text'
    case 'toolcall_start':
    case 'toolcall_delta':
      return 'tool-call'
    default:
      return current
  }
}

export function updateToolCallDrafts(
  current: PiResponseState['toolCallDrafts'],
  message: PiMessage,
  event: MessageUpdate
): PiResponseState['toolCallDrafts'] {
  const update = event.assistantMessageEvent
  if (update.type === 'toolcall_start') return { ...current, [update.id]: '' }
  if (update.type === 'toolcall_end') {
    const next = { ...current }
    delete next[update.toolCall.id]
    return next
  }
  if (update.type === 'toolcall_delta' && message.role === 'assistant') {
    const block = message.content[update.contentIndex]
    if (block?.type === 'toolCall') {
      return { ...current, [block.id]: (current[block.id] ?? '') + update.delta }
    }
  }
  return current
}

/** 用块级事件区分思考结束与整条助手消息结束，正文仍可能继续流式输出。 */
export function updateActiveThinking(
  current: PiSnapshot['activeThinking'],
  event: MessageUpdate,
  messageIndex: number
): PiSnapshot['activeThinking'] {
  const update = event.assistantMessageEvent
  switch (update.type) {
    case 'thinking_start':
    case 'thinking_delta':
      return { messageIndex, contentIndex: update.contentIndex }
    case 'thinking_end':
    case 'text_start':
    case 'toolcall_start':
      return null
    default:
      return current
  }
}

/** RPC 的 update 只有增量；按官方 contentIndex 重建，最终以 message_end 为准。 */
export function updateAssistantMessage(message: PiMessage, event: MessageUpdate): PiMessage {
  if (message.role !== 'assistant') return message
  const update = event.assistantMessageEvent
  if (!('contentIndex' in update)) return message

  const content = [...message.content]
  const index = update.contentIndex
  const block = content[index]
  switch (update.type) {
    case 'text_start':
      content[index] = { type: 'text', text: '' }
      break
    case 'text_delta':
      content[index] = {
        type: 'text',
        text: (block?.type === 'text' ? block.text : '') + update.delta
      }
      break
    case 'text_end':
      content[index] = { type: 'text', text: update.content }
      break
    case 'thinking_start':
      content[index] = { type: 'thinking', thinking: '' }
      break
    case 'thinking_delta':
      content[index] = {
        type: 'thinking',
        thinking: (block?.type === 'thinking' ? block.thinking : '') + update.delta
      }
      break
    case 'thinking_end':
      content[index] = { type: 'thinking', thinking: update.content }
      break
    case 'toolcall_start':
      content[index] = {
        type: 'toolCall',
        id: update.id,
        name: update.toolName,
        arguments: {}
      }
      break
    case 'toolcall_end':
      content[index] = update.toolCall
      break
  }
  return { ...message, content, usage: event.usage }
}
