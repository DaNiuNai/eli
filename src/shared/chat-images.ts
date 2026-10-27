export const imageExtension = /\.(?:avif|bmp|gif|ico|jpe?g|jfif|png|svg|webp)$/i
export const maxChatImageBytes = 32 * 1024 * 1024

export type ChatImageSource = { kind: 'local' | 'url'; value: string }

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
