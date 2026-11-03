import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { parse } from 'yaml'

export interface Skill {
  name: string
  description: string
  filePath: string
  baseDir: string
  disableModelInvocation: boolean
}

export function markdownResource(filePath: string): {
  attributes: Record<string, unknown>
  body: string
} {
  const text = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)
  if (!match) return { attributes: {}, body: text }
  const attributes: unknown = parse(match[1])
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes))
    throw new Error(`元数据格式无效：${filePath}`)
  return { attributes: attributes as Record<string, unknown>, body: text.slice(match[0].length) }
}

export function loadSkills(options: {
  skillPaths: string[]
  cwd?: string
  agentDir?: string
  includeDefaults?: boolean
}): {
  skills: Skill[]
  diagnostics: { path: string; message: string }[]
} {
  const skills = new Map<string, Skill>()
  const visited = new Set<string>()
  const diagnostics: { path: string; message: string }[] = []
  const visit = (path: string, root: boolean): void => {
    if (!existsSync(path)) return
    const key = realpathSync(path)
    if (visited.has(key)) return
    visited.add(key)
    if (statSync(path).isDirectory()) {
      const entry = join(path, 'SKILL.md')
      if (existsSync(entry)) {
        visit(entry, false)
        return
      }
      for (const child of readdirSync(path, { withFileTypes: true }).sort((a, b) =>
        a.name.localeCompare(b.name)
      )) {
        if (child.name.startsWith('.') || child.name === 'node_modules') continue
        if (child.isDirectory() || child.isSymbolicLink() || (root && child.name.endsWith('.md')))
          visit(join(path, child.name), false)
      }
      return
    }
    try {
      const { attributes } = markdownResource(path)
      const name = typeof attributes.name === 'string' ? attributes.name : basename(dirname(path))
      const description = attributes.description
      if (!name.trim() || typeof description !== 'string' || !description.trim())
        throw new Error('技能缺少名称或描述')
      if (!skills.has(name))
        skills.set(name, {
          name,
          description,
          filePath: resolve(path),
          baseDir: dirname(resolve(path)),
          disableModelInvocation: attributes['disable-model-invocation'] === true
        })
    } catch (error) {
      diagnostics.push({ path, message: error instanceof Error ? error.message : String(error) })
    }
  }
  for (const path of options.skillPaths) visit(path, true)
  return { skills: [...skills.values()], diagnostics }
}
