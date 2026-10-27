import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import {
  createCodemodeExtension,
  createEventBus,
  createExtensionRuntime,
  createMcpExtension,
  createToolSearchExtension,
  loadSkills,
  type ExtensionFactory,
  type LoadExtensionsResult,
  type ResourceLoader,
  type SettingsManager
} from '@earendil-works/pi-coding-agent'
import { sdkModules } from './sdk-adapter'
import { EliConfigStore } from '../config/store'
import { resourcePath } from './resource-path'
import { skillPathKey, userSkillPaths } from './skills'
import { managedMcpServers } from './mcp'
import { subagentToolNames } from './subagent-tools'

function readOptional(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function extensionFiles(path: string): string[] {
  if (!existsSync(path)) return []
  if (statSync(path).isFile()) return [path]
  for (const name of ['index.ts', 'index.js', 'index.mjs']) {
    if (existsSync(join(path, name))) return [join(path, name)]
  }
  return readdirSync(path, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      if (entry.isFile() && /\.(?:[cm]?js|ts)$/.test(entry.name) && !entry.name.endsWith('.d.ts'))
        return [join(path, entry.name)]
      if (entry.isDirectory()) {
        const index = ['index.ts', 'index.js', 'index.mjs'].find((name) =>
          existsSync(join(path, entry.name, name))
        )
        return index ? [join(path, entry.name, index)] : []
      }
      return []
    })
}

/** eli 决定发现规则；SDK 负责解析技能、模板及加载扩展。没有 pi 默认目录回退。 */
export class EliResourceLoader implements ResourceLoader {
  private extensions: LoadExtensionsResult = {
    extensions: [],
    errors: [],
    runtime: createExtensionRuntime()
  }
  private skills: ReturnType<ResourceLoader['getSkills']> = { skills: [], diagnostics: [] }
  private prompts: ReturnType<ResourceLoader['getPrompts']> = { prompts: [], diagnostics: [] }
  private agentsFiles: { path: string; content: string }[] = []
  private systemPrompt?: string
  private systemSource?: string
  private appendPrompts: { path: string; content: string }[] = []
  private additionalSkills: string[] = []
  private disabledSkills = new Set<string>()
  private additionalPrompts: string[] = []
  private sdk?: Awaited<ReturnType<typeof sdkModules>>

  constructor(
    private readonly root: string,
    private readonly cwd: string,
    private readonly settings: SettingsManager,
    private readonly hostExtension: ExtensionFactory
  ) {}

  getExtensions(): ReturnType<ResourceLoader['getExtensions']> {
    return this.extensions
  }
  getSkills(): ReturnType<ResourceLoader['getSkills']> {
    return this.skills
  }
  getPrompts(): ReturnType<ResourceLoader['getPrompts']> {
    return this.prompts
  }
  getThemes(): ReturnType<ResourceLoader['getThemes']> {
    return { themes: [], diagnostics: [] }
  }
  getAgentsFiles(): ReturnType<ResourceLoader['getAgentsFiles']> {
    return { agentsFiles: this.agentsFiles }
  }
  getSystemPrompt(): ReturnType<ResourceLoader['getSystemPrompt']> {
    return this.systemPrompt
  }
  getSystemPromptSource(): ReturnType<ResourceLoader['getSystemPromptSource']> {
    return this.systemSource ? { path: this.systemSource } : undefined
  }
  getAppendSystemPrompt(): ReturnType<ResourceLoader['getAppendSystemPrompt']> {
    return this.appendPrompts.map(({ content }) => content)
  }
  getAppendSystemPromptSources(): ReturnType<ResourceLoader['getAppendSystemPromptSources']> {
    return this.appendPrompts.map(({ path }) => ({ path }))
  }

  extendResources(paths: Parameters<ResourceLoader['extendResources']>[0]): void {
    this.additionalSkills.push(
      ...(paths.skillPaths ?? []).map(({ path }) => resourcePath(this.cwd, path))
    )
    this.additionalPrompts.push(
      ...(paths.promptPaths ?? []).map(({ path }) => resourcePath(this.cwd, path))
    )
    this.loadSkills()
    this.loadPrompts()
  }

  private paths(kind: 'skills' | 'prompts' | 'extensions'): string[] {
    const global = this.settings.getGlobalSettings()[kind] ?? []
    const project = this.settings.getProjectSettings()[kind] ?? []
    const globalDefaults = [join(this.root, kind)]
    const projectDefaults = [join(this.cwd, '.eli', kind)]
    const globalPaths = global.map((path) => resourcePath(this.root, path))
    const projectPaths = project.map((path) => resourcePath(join(this.cwd, '.eli'), path))
    if (kind === 'skills') {
      projectDefaults.push(join(this.cwd, '.agents', 'skills'))
    }
    const paths =
      kind === 'skills'
        ? [
            ...projectDefaults.filter(existsSync),
            ...projectPaths,
            ...userSkillPaths(this.root, global)
          ]
        : [
            ...globalDefaults.filter(existsSync),
            ...projectDefaults.filter(existsSync),
            ...globalPaths,
            ...projectPaths
          ]
    return [...new Set(paths)]
  }

  private loadSkills(): void {
    const loaded = loadSkills({
      cwd: this.cwd,
      agentDir: this.root,
      includeDefaults: false,
      skillPaths: [...this.paths('skills'), ...this.additionalSkills]
    })
    this.skills = {
      ...loaded,
      skills: loaded.skills.filter(
        ({ filePath }) => !this.disabledSkills.has(skillPathKey(filePath))
      )
    }
  }

  private loadPrompts(): void {
    if (!this.sdk) throw new Error('资源加载器尚未初始化')
    const { loadPromptTemplates } = this.sdk
    const { templates, diagnostics } = loadPromptTemplates({
      cwd: this.cwd,
      agentDir: this.root,
      includeDefaults: false,
      promptPaths: [...this.paths('prompts'), ...this.additionalPrompts]
    })
    this.prompts = { prompts: templates, diagnostics }
  }

  async reload(): Promise<void> {
    const sdk = await sdkModules()
    this.sdk = sdk
    const runtime = createExtensionRuntime()
    const bus = createEventBus()
    const configPath = join(this.root, 'config.json')
    const { agent, disabledSkills, mcpServers } = await new EliConfigStore(configPath).read()
    const managed = (await managedMcpServers(mcpServers)).map((server) => ({
      ...server,
      source: configPath,
      scope: 'global' as const
    }))
    const factories: [string, ExtensionFactory][] = [
      ['eli:host', this.hostExtension],
      ['builtin:codemode', createCodemodeExtension()],
      ['builtin:tool_search', createToolSearchExtension()],
      [
        'builtin:mcp',
        createMcpExtension({
          loadConfig: () => {
            const global = sdk.loadMcpConfig({
              agentDir: this.root,
              cwd: this.cwd,
              projectTrusted: false
            })
            const project = sdk.loadMcpConfig({
              agentDir: join(this.cwd, '.eli'),
              cwd: this.cwd,
              projectTrusted: false
            })
            return {
              servers: [
                ...new Map(
                  [...global.servers, ...managed, ...project.servers].map((server) => [
                    server.name,
                    server
                  ])
                ).values()
              ],
              autoEnableCodemode: project.autoEnableCodemode ?? global.autoEnableCodemode,
              errors: [...global.errors, ...project.errors]
            }
          },
          updateConfig: (entry, patch) => {
            if (entry.source === configPath)
              throw new Error('请在 eli 设置的 MCP 管理中修改此服务。')
            sdk.updateMcpServerConfig(entry.override ?? entry.source, entry.name, patch, {
              override: !!entry.override
            })
          },
          credentials: new sdk.McpOAuthCredentialStore(
            new sdk.FileAuthStorageBackend(join(this.root, 'mcp-auth.json')),
            join(this.root, 'mcp-locks')
          ),
          logPath: join(this.root, 'mcp.log')
        })
      ]
    ]
    const extensions = [] as LoadExtensionsResult['extensions']
    for (const [name, factory] of factories) {
      extensions.push(await sdk.loadExtensionFromFactory(factory, this.cwd, bus, runtime, name))
    }
    const configured = this.paths('extensions')
    for (const path of configured) if (!existsSync(path)) throw new Error(`扩展路径不存在：${path}`)
    const loaded = await sdk.loadExtensions(
      [...new Set(configured.flatMap(extensionFiles))],
      this.cwd,
      bus,
      runtime
    )
    if (loaded.errors.length)
      throw new Error(loaded.errors.map(({ path, error }) => `${path}: ${error}`).join('\n'))
    const reserved = ['ask_user_question', ...subagentToolNames]
    if (loaded.extensions.some((extension) => reserved.some((name) => extension.tools.has(name)))) {
      throw new Error('扩展不能覆盖 eli 保留的提问或协作工具')
    }
    this.extensions = { extensions: [...extensions, ...loaded.extensions], errors: [], runtime }
    this.disabledSkills = new Set((disabledSkills ?? []).map(skillPathKey))
    this.loadSkills()
    this.loadPrompts()
    // 默认说明在前，自定义文件按配置顺序追加；同一路径只加载一次。
    const ancestors: string[] = []
    for (let dir = resolve(this.cwd); ; dir = dirname(dir)) {
      ancestors.unshift(dir)
      if (dirname(dir) === dir) break
    }
    const seen = new Set<string>()
    this.agentsFiles = [
      join(this.root, 'AGENTS.md'),
      ...ancestors.map((dir) => join(dir, 'AGENTS.md')),
      join(this.cwd, '.eli', 'AGENTS.md'),
      ...(agent.agentsFiles ?? []).map((path) => resourcePath(this.root, path))
    ].flatMap((file) => {
      const path = resolve(file)
      const key = process.platform === 'win32' ? path.toLowerCase() : path
      if (seen.has(key)) return []
      seen.add(key)
      const content = readOptional(path)
      return content ? [{ path, content }] : []
    })
    this.systemSource = [join(this.cwd, '.eli', 'SYSTEM.md'), join(this.root, 'SYSTEM.md')].find(
      existsSync
    )
    this.systemPrompt = this.systemSource ? readOptional(this.systemSource) : undefined
    this.appendPrompts = [
      join(this.root, 'APPEND_SYSTEM.md'),
      join(this.cwd, '.eli', 'APPEND_SYSTEM.md')
    ].flatMap((path) => {
      const content = readOptional(path)
      return content ? [{ path, content }] : []
    })
  }
}
