import { mkdir, open, realpath, unlink } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { imageExtension, maxChatImageBytes } from '../shared/chat-images'

function localPath(source: string, cwd: string): string {
  let path = source.trim()
  if (/^file:/i.test(path)) {
    const url = new URL(path)
    if (url.hostname && url.hostname !== 'localhost') throw new Error('不支持网络共享图片路径')
    path = fileURLToPath(url)
  } else if (!/^[a-z]:[\\/]/i.test(path)) {
    if (/^[a-z][a-z\d+.-]*:/i.test(path)) throw new Error('只支持本机图片路径')
    path = path.split(/[?#]/, 1)[0]
  }
  if (/^[\\/]{2}/.test(path)) throw new Error('不支持网络共享图片路径')
  const absolute = resolve(cwd, path)
  if (!imageExtension.test(absolute)) throw new Error('不支持的图片格式')
  return absolute
}

function imageMime(bytes: Buffer, extension: string): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png'
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
  const header = bytes.toString('ascii', 0, 12)
  if (/^GIF8[79]a/.test(header)) return 'image/gif'
  if (header.startsWith('RIFF') && header.slice(8) === 'WEBP') return 'image/webp'
  if (header.startsWith('BM')) return 'image/bmp'
  if (bytes.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0]))) return 'image/x-icon'
  if (header.slice(4, 8) === 'ftyp') {
    for (let index = 8; index + 4 <= Math.min(bytes.length, 64); index += 4) {
      if (index !== 12 && /^(?:avif|avis)$/.test(bytes.toString('ascii', index, index + 4)))
        return 'image/avif'
    }
  }
  if (extension === '.svg') {
    const text = bytes.toString('utf8', 0, Math.min(bytes.length, 65536))
    if (
      /^\s*(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE\s+svg[\s\S]*?>\s*)?<svg(?:\s|>)/i.test(
        text
      )
    )
      return 'image/svg+xml'
  }
  return null
}

async function readImageFile(
  source: unknown,
  cwd: string
): Promise<{ content: Buffer; mime: string; path: string }> {
  if (typeof source !== 'string' || !source.trim() || source.length > 16384)
    throw new Error('无效的图片路径')
  const path = localPath(source, cwd)
  let resolved: string
  try {
    resolved = await realpath(path)
  } catch (error) {
    // Markdown 地址可能已编码空格、中文或 #；已有的字面文件名优先。
    const decoded = decodeURIComponent(path)
    if (decoded === path || !imageExtension.test(decoded)) throw error
    resolved = await realpath(decoded)
  }
  if (!imageExtension.test(resolved) || /^[\\/]{2}/.test(resolved))
    throw new Error('不支持的图片路径')
  const file = await open(resolved, 'r')
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size === 0 || info.size > maxChatImageBytes)
      throw new Error('图片为空或超过 32 MB')
    const bytes = Buffer.alloc(info.size)
    let offset = 0
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset)
      if (!bytesRead) break
      offset += bytesRead
    }
    const content = bytes.subarray(0, offset)
    const mime = imageMime(content, extname(resolved).toLowerCase())
    if (!mime) throw new Error('文件不是支持的图片')
    return { content, mime, path: resolved }
  } finally {
    await file.close()
  }
}

export async function readLocalImage(source: unknown, cwd: string): Promise<string> {
  const { content, mime } = await readImageFile(source, cwd)
  return `data:${mime};base64,${content.toString('base64')}`
}

/** 已有路径的图片直接引用源文件，按数组顺序校验。 */
export async function resolvePromptImages(sources: unknown, cwd: string): Promise<string[]> {
  if (!Array.isArray(sources) || sources.some((source) => typeof source !== 'string'))
    throw new Error('无效的图片列表')
  const paths: string[] = []
  for (const source of sources) {
    const image = await readImageFile(source, cwd)
    paths.push(image.path)
  }
  return paths
}

/** 剪贴板或无本地路径的图片才落盘，按实际格式命名并保留原始字节。 */
export async function saveImageData(
  bytes: unknown,
  directory = join(homedir(), '.eli', 'images')
): Promise<string> {
  if (!(bytes instanceof Uint8Array)) throw new Error('无效的图片数据')
  if (!bytes.byteLength || bytes.byteLength > maxChatImageBytes)
    throw new Error('图片为空或超过 32 MB')
  const content = Buffer.from(bytes)
  const mime = imageMime(content, '.svg')
  if (!mime) throw new Error('文件不是支持的图片')
  const extensions: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/bmp': '.bmp',
    'image/x-icon': '.ico',
    'image/avif': '.avif',
    'image/svg+xml': '.svg'
  }
  await mkdir(directory, { recursive: true })
  const path = join(directory, `${randomUUID()}${extensions[mime]}`)
  const file = await open(path, 'wx')
  try {
    await file.writeFile(content)
  } catch (error) {
    await file.close()
    await unlink(path).catch(() => {})
    throw error
  }
  await file.close()
  return path
}
