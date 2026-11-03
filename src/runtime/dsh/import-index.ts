import { stat } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { JsonStore } from '../../config/store'

interface ImportRecord {
  id: string
  digest: string
  bytes: number
  modified: number
}
type ImportIndex = Record<string, ImportRecord>

export function importKey(directory: string, path: string): string | undefined {
  const key = relative(directory, path).replaceAll('\\', '/')
  if (!key || isAbsolute(key) || key.startsWith('../')) return undefined
  return process.platform === 'win32' ? key.toLowerCase() : key
}

export function importIndex(directory: string): JsonStore<ImportIndex> {
  return new JsonStore(join(directory, 'imports.json'), (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('会话迁移索引无效')
    for (const entry of Object.values(value)) {
      if (
        !entry ||
        typeof entry.id !== 'string' ||
        typeof entry.digest !== 'string' ||
        !Number.isFinite(entry.bytes) ||
        !Number.isFinite(entry.modified)
      )
        throw new Error('会话迁移记录无效')
    }
    return value as ImportIndex
  })
}

export async function rememberImport(
  directory: string,
  path: string,
  id: string,
  digest: string
): Promise<void> {
  const key = importKey(directory, path)
  if (!key) return
  const info = await stat(path)
  const store = importIndex(directory)
  const previous = (await store.read())[key]
  if (
    previous?.id === id &&
    previous.digest === digest &&
    previous.modified === info.mtimeMs &&
    previous.bytes === info.size
  )
    return
  await store.update((index) => {
    index[key] = { id, digest, bytes: info.size, modified: info.mtimeMs }
  })
}
