import type { PiSkillCommand } from '../../../shared/pi'

export interface SkillQuery {
  query: string
  end: number
}

export function getSkillQuery(draft: string, start: number, end: number): SkillQuery | null {
  if (start !== end || start < 1) return null
  const match = /^\/([^\s/]*)(?=\s|$)/.exec(draft)
  if (!match || start > match[0].length) return null
  return { query: draft.slice(1, start).toLowerCase(), end: match[0].length }
}

export function filterSkillCommands(skills: PiSkillCommand[], query: string): PiSkillCommand[] {
  return skills.filter(
    ({ name, description }) =>
      name.toLowerCase().includes(query) || description?.toLowerCase().includes(query)
  )
}

export function completeSkillCommand(draft: string, end: number, name: string): string {
  return `/${name}${draft.slice(end) || ' '}`
}
