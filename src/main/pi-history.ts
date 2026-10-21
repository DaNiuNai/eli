import type {
  RpcClient,
  SessionManager,
  SessionMessageEntry,
  SessionProjection
} from '@earendil-works/pi-coding-agent'
import type { PiMessage } from '../shared/pi'

/** 将运行时消息关联到持久化条目；无法精确匹配的消息不开放历史修改操作。 */
export function mapMessageEntryIds(
  messages: PiMessage[],
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

export async function readHistoryTarget(
  path: string,
  entryId: string,
  role: 'user' | 'assistant'
): Promise<{ manager: SessionManager; entry: SessionMessageEntry; message: PiMessage }> {
  const { SessionManager } = await import('@earendil-works/pi-coding-agent')
  const manager = SessionManager.open(path)
  const projected = manager
    .buildSessionProjection()
    .entries.find(({ sourceEntry }) => sourceEntry.id === entryId)
  const entry = projected?.sourceEntry
  const message = projected?.messages.find((message) => message.role === role)
  if (!entry || entry.type !== 'message' || !message) {
    throw new Error('该消息已不在当前会话中，请刷新后重试')
  }
  return { manager, entry, message }
}

/** 只复制选中分支的完整路径，新文件拥有独立的会话 ID 和后续写入。 */
export async function copySessionThrough(path: string, entryId: string): Promise<string> {
  const { manager } = await readHistoryTarget(path, entryId, 'assistant')
  const firstUser = manager
    .getBranch(entryId)
    .find((entry) => entry.type === 'message' && entry.message.role === 'user')
  const firstContent =
    firstUser?.type === 'message' && firstUser.message.role === 'user'
      ? firstUser.message.content
      : ''
  const firstText =
    typeof firstContent === 'string'
      ? firstContent
      : firstContent
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('\n')
  const name = manager.getSessionName() || firstText.trim().slice(0, 80) || '新对话'
  const copiedPath = manager.createBranchedSession(entryId)
  if (!copiedPath) throw new Error('无法创建独立会话文件')
  manager.appendSessionInfo(`${name} · 分叉`)
  return copiedPath
}

/** 追加新的分支起点，旧记录仍可恢复，但不再参与当前会话的显示与模型上下文。 */
export async function rewindSessionBefore(
  path: string,
  entryId: string
): Promise<{
  previousLeaf: string | null
  images: NonNullable<Parameters<RpcClient['prompt']>[1]>
}> {
  const { manager, entry, message } = await readHistoryTarget(path, entryId, 'user')
  const previousLeaf = manager.getLeafId()
  if (entry.parentId) manager.branch(entry.parentId)
  else manager.resetLeaf()
  manager.appendCustomEntry('eli.message_edit')
  const images =
    message.role === 'user' && Array.isArray(message.content)
      ? message.content.filter((part) => part.type === 'image')
      : []
  return { previousLeaf, images }
}

export async function restoreSessionLeaf(path: string, leafId: string): Promise<void> {
  const { SessionManager } = await import('@earendil-works/pi-coding-agent')
  const manager = SessionManager.open(path)
  manager.branch(leafId)
  manager.appendCustomEntry('eli.message_edit_rollback')
}
