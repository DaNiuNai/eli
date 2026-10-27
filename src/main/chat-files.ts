import { mkdir, realpath, stat, writeFile, unlink, rmdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { imageExtension } from '../shared/chat-images'
import { maxChatFileBytes } from '../shared/chat-attachments'
import { resolvePromptImages } from './image-files'

/** 普通文件只校验路径，不把文件内容读入消息；图片保留原有格式校验。 */
export async function resolvePromptFiles(sources: unknown, cwd: string): Promise<string[]> {
  if (!Array.isArray(sources) || sources.some((source) => typeof source !== 'string'))
    throw new Error('无效的附件列表')
  const paths: string[] = []
  for (const source of sources) {
    if (!source.trim() || source.length > 16384 || /[\0\r\n"]/.test(source))
      throw new Error('无效的文件路径')
    let path = source
    if (/^file:/i.test(path)) {
      const url = new URL(path)
      if (url.hostname && url.hostname !== 'localhost') throw new Error('只支持本机文件路径')
      path = fileURLToPath(url)
    } else if (!/^[a-z]:[\\/]/i.test(path) && /^[a-z][a-z\d+.-]*:/i.test(path)) {
      throw new Error('只支持本机文件路径')
    }
    if (/^[\\/]{2}/.test(path)) throw new Error('只支持本机文件路径')
    const resolved = await realpath(resolve(cwd, path))
    if (/^[\\/]{2}/.test(resolved)) throw new Error('只支持本机文件路径')
    if (!(await stat(resolved)).isFile()) throw new Error('请选择本机文件')
    if (imageExtension.test(resolved)) await resolvePromptImages([resolved], cwd)
    paths.push(resolved)
  }
  return paths
}

/** 无本地路径的拖拽文件保存到独立目录，保留文件名和原始字节。 */
export async function saveFileData(
  name: unknown,
  bytes: unknown,
  directory = join(homedir(), '.eli', 'files')
): Promise<string> {
  if (typeof name !== 'string' || !name || /[\0\r\n"]/.test(name)) throw new Error('无效的文件名')
  const filename = basename(name.replaceAll('\\', '/'))
  if (!filename || filename === '.' || filename === '..') throw new Error('无效的文件名')
  if (!(bytes instanceof Uint8Array)) throw new Error('无效的文件数据')
  if (bytes.byteLength > maxChatFileBytes) throw new Error('文件超过 32 MB')
  const folder = join(directory, randomUUID())
  await mkdir(folder, { recursive: true })
  const path = join(folder, filename)
  try {
    await writeFile(path, bytes, { flag: 'wx' })
  } catch (error) {
    await unlink(path).catch(() => {})
    await rmdir(folder).catch(() => {})
    throw error
  }
  return path
}
