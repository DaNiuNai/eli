import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { EliConfigStore } from '../config/store'
import { resourcePath } from './resource-path'
import { skillPathKey, userSkillPaths } from './skills'
import { loadSkills, markdownResource, type Skill } from './skill-loader'
import type { RuntimeSettings } from './settings'
import type { PluginEntry } from '../shared/plugins'

function optional(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function pluginFiles(path: string): string[] {
  if (!existsSync(path)) throw new Error(`扩展路径不存在：${path}`)
  if (statSync(path).isFile()) return [path]
  const names = ['index.mjs', 'index.js', 'index.ts']
  const entry = names.find((name) => existsSync(join(path, name)))
  if (entry) return [join(path, entry)]
  return readdirSync(path, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((item) => {
      if (item.isFile() && /\.(?:m?js|ts)$/.test(item.name) && !item.name.endsWith('.d.ts'))
        return [join(path, item.name)]
      if (item.isDirectory()) {
        const entry = names.find((name) => existsSync(join(path, item.name, name)))
        return entry ? [join(path, item.name, entry)] : []
      }
      return []
    })
}

export class EliResourceLoader {
  private skills: Skill[] = []
  private prompt = ''
  private templates = new Map<string, string>()
  private extensions: PluginEntry[] = []
  constructor(
    private readonly root: string,
    private readonly cwd: string,
    private readonly settings: RuntimeSettings
  ) {}

  getSkills(): { skills: Skill[] } {
    return { skills: this.skills }
  }
  getSystemPrompt(): string {
    return this.prompt
  }
  getPlugins(): PluginEntry[] {
    return this.extensions
  }

  expandPrompt(text: string): string {
    const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text)
    if (!match) return text
    if (match[1].startsWith('skill:') && this.settings.getEnableSkillCommands()) {
      const skill = this.skills.find(({ name }) => name === match[1].slice(6))
      if (skill)
        return `<skill name="${skill.name}" location="${skill.filePath}">\n${readFileSync(skill.filePath, 'utf8')}\n</skill>\n${match[2] ?? ''}`
    }
    const template = this.templates.get(match[1])
    if (!template) return text
    const args =
      (match[2] ?? '').match(/(?:[^\s"]+|"[^"]*")+/g)?.map((arg) => arg.replace(/^"|"$/g, '')) ?? []
    return template.replace(/\$ARGUMENTS|\$@|\$(\d+)/g, (token, index) =>
      index ? (args[Number(index) - 1] ?? '') : (match[2] ?? token.replace(/.*/s, ''))
    )
  }

  async reload(): Promise<void> {
    const config = await new EliConfigStore(join(this.root, 'config.json')).read()
    const paths = [
      join(this.cwd, '.eli', 'skills'),
      join(this.cwd, '.agents', 'skills'),
      ...userSkillPaths(this.root, config.agent.skills ?? [])
    ]
    const disabled = new Set((config.disabledSkills ?? []).map(skillPathKey))
    this.skills = loadSkills({ skillPaths: paths }).skills.filter(
      ({ filePath }) => !disabled.has(skillPathKey(filePath))
    )
    const ancestors: string[] = []
    for (let directory = resolve(this.cwd); ; directory = dirname(directory)) {
      ancestors.unshift(directory)
      if (dirname(directory) === directory) break
    }
    const instructions = [
      join(this.root, 'AGENTS.md'),
      ...ancestors.map((directory) => join(directory, 'AGENTS.md')),
      join(this.cwd, '.eli', 'AGENTS.md'),
      ...(config.agent.agentsFiles ?? []).map((path) => resourcePath(this.root, path))
    ]
    const seen = new Set<string>()
    const sections = instructions.flatMap((path) => {
      const key = skillPathKey(path)
      if (seen.has(key)) return []
      seen.add(key)
      const text = optional(path)
      return text ? [`<instructions path=${JSON.stringify(path)}>\n${text}\n</instructions>`] : []
    })
    const base =
      optional(join(this.cwd, '.eli', 'SYSTEM.md')) ??
      optional(join(this.root, 'SYSTEM.md')) ??
      '你是 eli，一个在用户工作目录中工作的编程助手。遵循用户指示，使用工具核实信息，准确报告修改与验证结果。'
    const skills = this.skills
      .filter((skill) => !skill.disableModelInvocation)
      .map(
        (skill) =>
          `<skill><name>${skill.name}</name><description>${skill.description}</description><location>${skill.filePath}</location></skill>`
      )
      .join('\n')
    this.prompt = [
      base,
      ...sections,
      optional(join(this.root, 'APPEND_SYSTEM.md')),
      optional(join(this.cwd, '.eli', 'APPEND_SYSTEM.md')),
      skills
        ? `使用匹配的技能前，先读取其 SKILL.md。\n<available_skills>\n${skills}\n</available_skills>`
        : ''
    ]
      .filter(Boolean)
      .join('\n\n')
    this.templates.clear()
    for (const path of [
      join(this.root, 'prompts'),
      join(this.cwd, '.eli', 'prompts'),
      ...(config.agent.prompts ?? []).map((path) => resourcePath(this.root, path))
    ]) {
      if (!existsSync(path)) continue
      const files = statSync(path).isFile()
        ? [path]
        : readdirSync(path)
            .filter((name) => name.endsWith('.md'))
            .map((name) => join(path, name))
      for (const file of files)
        this.templates.set(basename(file, '.md'), markdownResource(file).body)
    }
    const extensionPaths = [
      join(this.root, 'extensions'),
      join(this.cwd, '.eli', 'extensions')
    ].filter(existsSync)
    extensionPaths.push(
      ...(config.agent.extensions ?? []).map((path) => resourcePath(this.root, path))
    )
    this.extensions = [...new Set(extensionPaths.flatMap(pluginFiles))].map((name, index) => ({
      id: `extension-${index}`,
      name
    }))
  }
}
