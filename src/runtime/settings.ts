import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { EliConfigStore } from '../config/store'
import type { AgentSettings } from '../shared/agent-config'
import type { AgentThinkingLevel } from '../shared/agent-messages'

/** 单次插件树的配置快照；持久化仍由 EliConfigStore 统一负责。 */
export class RuntimeSettings {
  constructor(private readonly values: AgentSettings) {}

  getSettings(): AgentSettings {
    return structuredClone(this.values)
  }
  getDefaultThinkingLevel(): AgentThinkingLevel {
    return this.values.defaultThinkingLevel ?? 'medium'
  }
  setDefaultThinkingLevel(level: AgentThinkingLevel): void {
    this.values.defaultThinkingLevel = level
  }
  getOrCreateDeviceId(): string {
    return (this.values.deviceId ??= randomUUID())
  }
  getModelThinkingLevel(provider: string, model: string): AgentThinkingLevel | undefined {
    return this.values.modelThinkingLevels?.[`${provider}/${model}`]
  }
  getHttpIdleTimeoutMs(): number {
    return this.values.httpIdleTimeoutMs ?? 300000
  }
  getHideThinkingBlock(): boolean {
    return this.values.hideThinkingBlock ?? false
  }
  getEnableSkillCommands(): boolean {
    return this.values.enableSkillCommands ?? true
  }
  getCompactionSettings(model?: { provider: string; id: string }): {
    enabled: boolean
    reserveTokens: number
    keepRecentTokens: number
  } {
    const config = this.values.compaction
    const overrides = model && config?.modelOverrides?.[`${model.provider}/${model.id}`]
    return {
      enabled: config?.enabled ?? true,
      reserveTokens: overrides?.reserveTokens ?? config?.reserveTokens ?? 16384,
      keepRecentTokens: overrides?.keepRecentTokens ?? config?.keepRecentTokens ?? 20000
    }
  }
}

export async function createSettings(root: string): Promise<RuntimeSettings> {
  const { agent, deviceId } = await new EliConfigStore(join(root, 'config.json')).read()
  return new RuntimeSettings({ ...agent, ...(deviceId ? { deviceId } : {}) })
}
