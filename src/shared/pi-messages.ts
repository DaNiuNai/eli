import type { JsonAgentSessionEvent } from '@earendil-works/pi-coding-agent'
import type { PiMessage } from './pi'

type MessageUpdate = Extract<JsonAgentSessionEvent, { type: 'message_update' }>

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
