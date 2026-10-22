export const imageExtension = /\.(?:avif|bmp|gif|ico|jpe?g|jfif|png|svg|webp)$/i
export const maxChatImageBytes = 32 * 1024 * 1024

export type ChatImageSource = { kind: 'local' | 'url'; value: string }

export interface ChatDraftImage {
  id: string
  path: string
}

/** 图片顺序只取决于数组位置，编号不受异步读取或文件名影响。 */
export function formatChatImageMessage(text: string, paths: string[]): string {
  const references = paths.map((path, index) => `[图片${index + 1}]("${path}")`).join('\n')
  return [references, text.trim()].filter(Boolean).join('\n\n')
}

/** 只还原应用在消息开头写入的连续图片编号，普通用户文本保持原样。 */
export function parseChatImageMessage(message: string): { images: ChatDraftImage[]; text: string } {
  const images: ChatDraftImage[] = []
  let text = message
  while (true) {
    const match = /^\[图片(\d+)\]\("([^"\r\n]+)"\)(?:\r?\n|$)/.exec(text)
    if (!match || Number(match[1]) !== images.length + 1 || !imageExtension.test(match[2])) break
    if (getChatImageSource(match[2])?.kind !== 'local') break
    images.push({ id: String(images.length), path: match[2] })
    text = text.slice(match[0].length)
  }
  return { images, text: images.length ? text.replace(/^\r?\n/, '') : message }
}

export function getChatImageSource(source: string): ChatImageSource | null {
  let value = source.trim()
  if (!value) return null
  if (/^[a-z]:%(?:5c|2f)/i.test(value)) {
    try {
      value = decodeURIComponent(value)
    } catch {
      return null
    }
  }
  if (/^https?:\/\//i.test(value) || value.startsWith('//')) {
    try {
      const url = new URL(value.startsWith('//') ? `https:${value}` : value)
      return { kind: 'url', value: url.href }
    } catch {
      return null
    }
  }
  if (/^data:image\/(?:avif|bmp|gif|x-icon|jpeg|png|svg\+xml|webp)(?:;|,)/i.test(value)) {
    return { kind: 'url', value }
  }
  if (/^file:/i.test(value) || /^[a-z]:[\\/]/i.test(value)) {
    return { kind: 'local', value }
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return null
  return { kind: 'local', value }
}

/** 普通链接只有明确指向图片文件时才转为内嵌图片。 */
export function isChatImageReference(source: string): boolean {
  const image = getChatImageSource(source)
  if (!image) return false
  if (/^data:/i.test(image.value)) return true
  let path = image.value
  if (/^(?:https?|file):/i.test(path)) {
    try {
      path = new URL(path).pathname
    } catch {
      return false
    }
  } else if (!/^[a-z]:[\\/]/i.test(path)) {
    path = path.split(/[?#]/, 1)[0]
  }
  if (imageExtension.test(path)) return true
  try {
    path = decodeURIComponent(path)
  } catch {
    return false
  }
  return imageExtension.test(path)
}
