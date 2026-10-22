import type { SessionProjection } from '@earendil-works/pi-coding-agent'
import type { AgentMessage } from '../shared/agent'

/** 将运行时消息关联到持久化条目；无法精确匹配的消息不开放历史修改操作。 */
export function mapMessageEntryIds(
  messages: AgentMessage[],
  projection: SessionProjection
): (string | null)[] {
  const sources = projection.entries.flatMap(({ sourceEntry, messages }) =>
    messages.map((message) => ({ id: sourceEntry.id, value: JSON.stringify(message) }))
  )
  let cursor = 0
  return messages.map((message) => {
    const value = JSON.stringify(message)
    for (let index = cursor; index < sources.length; index++) {
      if (sources[index].value !== value) continue
      cursor = index + 1
      return sources[index].id
    }
    return null
  })
}
