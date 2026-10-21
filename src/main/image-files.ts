import { open, realpath } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { imageExtension } from '../shared/chat-images'

const maxImageBytes = 32 * 1024 * 1024

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

export async function readLocalImage(source: unknown, cwd: string): Promise<string> {
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
    if (!info.isFile() || info.size === 0 || info.size > maxImageBytes)
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
    return `data:${mime};base64,${content.toString('base64')}`
  } finally {
    await file.close()
  }
}
