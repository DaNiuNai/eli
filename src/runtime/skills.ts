import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { loadSkills } from '@earendil-works/pi-coding-agent'
import type { EliConfig } from '../config/schema'
import { EliConfigStore } from '../config/store'
import type { UserSkill } from '../shared/skills'
import { resourcePath } from './resource-path'

export function skillPathKey(path: string): string {
  const absolute = resolve(path)
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute
}

export function userSkillPaths(root: string, configured: string[]): string[] {
  return [
    ...[join(root, 'skills'), join(dirname(root), '.agents', 'skills')].filter(existsSync),
    ...configured.map((path) => resourcePath(root, path))
  ]
}

function userSkills(root: string, config: EliConfig): UserSkill[] {
  const loaded = loadSkills({
    cwd: root,
    agentDir: root,
    includeDefaults: false,
    skillPaths: userSkillPaths(root, config.agent.skills ?? [])
  })
  const disabled = new Set((config.disabledSkills ?? []).map(skillPathKey))
  return loaded.skills
    .map(({ name, description, filePath }) => ({
      name,
      description,
      filePath,
      enabled: !disabled.has(skillPathKey(filePath))
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** 用户级 Skill 始终完整发现，开关只保存在 eli 自己的配置中。 */
export class SkillsService {
  private readonly store: EliConfigStore

  constructor(private readonly root: string) {
    this.store = new EliConfigStore(join(root, 'config.json'))
  }

  async get(): Promise<UserSkill[]> {
    return userSkills(this.root, await this.store.read())
  }

  async setEnabled(filePath: unknown, enabled: unknown): Promise<UserSkill[]> {
    if (typeof filePath !== 'string' || !filePath || typeof enabled !== 'boolean')
      throw new Error('无效的 Skill 开关设置')
    await this.store.update((config) => {
      const skill = userSkills(this.root, config).find(
        (skill) => skillPathKey(skill.filePath) === skillPathKey(filePath)
      )
      if (!skill) throw new Error('用户级 Skill 不存在，请重新加载')
      const key = skillPathKey(skill.filePath)
      const disabled = (config.disabledSkills ?? []).filter((path) => skillPathKey(path) !== key)
      if (!enabled) disabled.push(skill.filePath)
      if (disabled.length) config.disabledSkills = disabled
      else delete config.disabledSkills
    })
    return this.get()
  }
}
