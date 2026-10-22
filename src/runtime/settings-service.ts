import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { settingsStorage, createSettings } from './settings'
import {
  agentSettingDefinitions,
  settingValue,
  type AgentSettingsChange,
  type AgentSettingsSnapshot
} from '../shared/agent-settings'

interface Schema {
  $ref?: string
  $defs?: Record<string, Schema>
  type?: string
  const?: unknown
  enum?: unknown[]
  anyOf?: Schema[]
  properties?: Record<string, Schema>
  patternProperties?: Record<string, Schema>
  items?: Schema
  required?: string[]
  minimum?: number
  maximum?: number
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function matches(value: unknown, schema: Schema, root: Schema, depth = 0): boolean {
  if (depth > 20) return false
  if (schema.$ref) {
    const target = root.$defs?.[schema.$ref.replace('#/$defs/', '')]
    return !!target && matches(value, target, root, depth + 1)
  }
  if (schema.anyOf) return schema.anyOf.some((item) => matches(value, item, root, depth + 1))
  if (Object.hasOwn(schema, 'const')) return value === schema.const
  if (schema.enum) return schema.enum.includes(value)
  if (schema.type === 'object') {
    if (!record(value) || schema.required?.some((key) => !Object.hasOwn(value, key))) return false
    return Object.entries(value).every(([key, item]) => {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) return false
      const child = schema.properties?.[key] ?? Object.values(schema.patternProperties ?? {})[0]
      return !!child && matches(item, child, root, depth + 1)
    })
  }
  if (schema.type === 'array') {
    return (
      Array.isArray(value) &&
      !!schema.items &&
      value.every((item) => matches(item, schema.items!, root, depth + 1))
    )
  }
  if (schema.type === 'number' || schema.type === 'integer') {
    return (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      (schema.type !== 'integer' || Number.isSafeInteger(value)) &&
      (schema.minimum === undefined || value >= schema.minimum) &&
      (schema.maximum === undefined || value <= schema.maximum)
    )
  }
  return typeof value === schema.type
}

function patch(
  settings: Record<string, unknown>,
  key: string,
  value: unknown,
  reset: boolean
): void {
  const parts = key.split('.')
  const parents: [Record<string, unknown>, string][] = []
  let target = settings
  for (const part of parts.slice(0, -1)) {
    if (!record(target[part])) target[part] = {}
    parents.push([target, part])
    target = target[part] as Record<string, unknown>
  }
  const leaf = parts.at(-1)!
  if (reset) delete target[leaf]
  else target[leaf] = value
  for (const [parent, part] of parents.reverse()) {
    if (Object.keys(parent[part] as object).length === 0) delete parent[part]
  }
}

/** 逐字段修改，沿用 PI 的文件锁与配置迁移，保留未知字段和其他进程的修改。 */
export class AgentSettingsService {
  constructor(private readonly root: string) {}
  private schema?: Promise<Schema>
  private loadSchema(): Promise<Schema> {
    this.schema ??= import('@earendil-works/pi-coding-agent').then(
      async ({ getPackageDir }) =>
        JSON.parse(
          await readFile(join(getPackageDir(), 'schemas/settings.schema.json'), 'utf8')
        ) as Schema
    )
    return this.schema
  }
  async get(): Promise<AgentSettingsSnapshot> {
    const manager = await createSettings(this.root)
    const global = manager.getGlobalSettings()
    const values: Record<string, unknown> = {}
    for (const field of agentSettingDefinitions) {
      values[field.key] = settingValue(global, field.key)
    }
    return { values }
  }

  async save(changes: unknown): Promise<AgentSettingsSnapshot> {
    if (
      !Array.isArray(changes) ||
      changes.length === 0 ||
      changes.length > agentSettingDefinitions.length
    )
      throw new Error('无效的设置变更')
    if (JSON.stringify(changes).length > 100_000) throw new Error('设置内容过长')
    const schema = await this.loadSchema()
    const seen = new Set<string>()
    for (const change of changes) {
      if (!record(change) || typeof change.key !== 'string' || seen.has(change.key))
        throw new Error('无效的设置项')
      seen.add(change.key)
      const field = agentSettingDefinitions.find(({ key }) => key === change.key)
      if (!field) throw new Error('无效的设置项')
      if (change.reset === true) continue
      const childSchema = change.key
        .split('.')
        .reduce<Schema | undefined>((current, key) => current?.properties?.[key], schema)
      if (!childSchema || !matches(change.value, childSchema, schema))
        throw new Error(`${field.label}：格式无效`)
      if (
        field.kind === 'number' &&
        (typeof change.value !== 'number' ||
          !Number.isSafeInteger(change.value) ||
          change.value < (field.min ?? 0))
      )
        throw new Error(`${field.label}：请输入有效的非负整数`)
    }
    const { SettingsManager } = await import('@earendil-works/pi-coding-agent')
    const storage = await settingsStorage(this.root)
    storage.withLock('global', (current) => {
      const parsed: unknown = current ? JSON.parse(current.replace(/^\uFEFF/, '')) : {}
      if (!record(parsed)) throw new Error('eli 设置必须是 JSON 对象')
      const migrated = SettingsManager.inMemory(parsed).getGlobalSettings() as Record<
        string,
        unknown
      >
      for (const change of changes as AgentSettingsChange[]) {
        if (JSON.stringify(settingValue(migrated, change.key)) !== JSON.stringify(change.expected))
          throw new Error('设置已被其他操作修改，请重新加载后再试')
        patch(migrated, change.key, change.value, change.reset === true)
      }
      return `${JSON.stringify(migrated, null, 2)}\n`
    })
    return this.get()
  }
}
