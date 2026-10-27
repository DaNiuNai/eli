import { getChatImageSource, imageExtension } from './chat-images'

export const maxChatFileBytes = 32 * 1024 * 1024

export interface ChatDraftAttachment {
  id: string
  path: string
}

export function chatAttachmentName(path: string): string {
  return path.split(/[\\/]/).at(-1) || path
}

/** 附件按添加顺序引用；图片保留原有编号，其他文件使用文件名。 */
export function formatChatAttachmentMessage(text: string, paths: string[]): string {
  const references = paths
    .map((path, index) => {
      const label = imageExtension.test(path) ? `图片${index + 1}` : chatAttachmentName(path)
      return `[${label.replace(/([\\[\]])/g, '\\$1')}]("${path}")`
    })
    .join('\n')
  return [references, text.trim()].filter(Boolean).join('\n\n')
}

/** 还原应用写入的附件前缀，同时兼容历史消息中的图片引用。 */
export function parseChatAttachmentMessage(message: string): {
  attachments: ChatDraftAttachment[]
  text: string
} {
  const attachments: ChatDraftAttachment[] = []
  let text = message
  while (true) {
    const match = /^\[((?:\\.|[^\]\\\r\n])*)\]\("([^"\r\n]+)"\)(?:\r?\n|$)/.exec(text)
    if (!match || getChatImageSource(match[2])?.kind !== 'local') break
    const label = match[1].replace(/\\([\\[\]])/g, '$1')
    const expected = imageExtension.test(match[2])
      ? `图片${attachments.length + 1}`
      : chatAttachmentName(match[2])
    if (label !== expected) break
    attachments.push({ id: String(attachments.length), path: match[2] })
    text = text.slice(match[0].length)
  }
  return { attachments, text: attachments.length ? text.replace(/^\r?\n/, '') : message }
}
