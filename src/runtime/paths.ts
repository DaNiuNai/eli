import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** 所有持久化路径由 eli 指定，不依赖 SDK 的默认目录或环境变量。 */
export interface RuntimePaths {
  root: string
  preferences: string
  modelCache: string
  sessions: string
  images: string
}

export function runtimePaths(root = join(homedir(), '.eli')): RuntimePaths {
  const directory = resolve(root)
  return {
    root: directory,
    preferences: join(directory, 'config.json'),
    modelCache: join(directory, 'models-store.json'),
    sessions: join(directory, 'sessions'),
    images: join(directory, 'images')
  }
}

export function workspaceSessionDirectory(root: string, cwd: string): string {
  const normalized = resolve(cwd)
  const key = process.platform === 'win32' ? normalized.toLowerCase() : normalized
  return join(
    runtimePaths(root).sessions,
    createHash('sha256').update(key).digest('hex').slice(0, 24)
  )
}
