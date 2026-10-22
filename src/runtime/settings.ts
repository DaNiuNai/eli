import { join } from 'node:path'
import { SettingsManager } from '@earendil-works/pi-coding-agent'
import { sdkModules } from './sdk-adapter'

export interface SettingsStorage {
  withLock(
    scope: 'global' | 'project',
    update: (text: string | undefined) => string | undefined
  ): void
}

export async function settingsStorage(root: string, cwd?: string): Promise<SettingsStorage> {
  const { FileSettingsStorage } = await sdkModules()
  const global = new FileSettingsStorage(root, root)
  const project = cwd ? new FileSettingsStorage(cwd, join(cwd, '.eli')) : undefined
  return {
    withLock(
      scope: 'global' | 'project',
      update: (text: string | undefined) => string | undefined
    ) {
      const storage = scope === 'global' ? global : project
      // 两个存储均只使用显式目录中的 global 槽，不触发 SDK 的 .pi 项目路径。
      if (storage) storage.withLock('global', update)
      else update(undefined)
    }
  }
}

export async function createSettings(root: string, cwd?: string): Promise<SettingsManager> {
  const manager = SettingsManager.fromStorage(await settingsStorage(root, cwd), {
    projectTrusted: true
  })
  const errors = manager.drainErrors()
  if (errors.length)
    throw new Error(`无法读取 eli 设置：${errors.map(({ error }) => error.message).join('；')}`)
  return manager
}
