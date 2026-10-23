import { join } from 'node:path'
import { SettingsManager } from '@earendil-works/pi-coding-agent'
import { EliConfigStore } from '../config/store'

/** 只向 SDK 注入内存设置；SDK 的后续设置变更不回写任何配置文件。 */
export async function createSettings(root: string): Promise<SettingsManager> {
  const { agent, deviceId } = await new EliConfigStore(join(root, 'config.json')).read()
  return SettingsManager.inMemory(
    { ...agent, ...(deviceId ? { deviceId } : {}) },
    { projectTrusted: true }
  )
}
