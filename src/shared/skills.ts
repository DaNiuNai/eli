export interface UserSkill {
  name: string
  description: string
  filePath: string
  enabled: boolean
}

export type CommonSkillsInstallResult = 'started' | 'node-required'
