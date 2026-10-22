import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { homedir } from 'node:os'
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

function readOptional(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function resourcePath(base: string, path: string): string {
  const expanded = path.replace(/^~(?=$|[\\/])/, homedir())
  return isAbsolute(expanded) ? expanded : resolve(base, expanded)
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
    return [
      ...new Set([
        ...[join(this.root, kind), join(this.cwd, '.eli', kind)].filter(existsSync),
        ...global.map((path) => resourcePath(this.root, path)),
        ...project.map((path) => resourcePath(join(this.cwd, '.eli'), path))
      ])
    ]
  }

  private loadSkills(): void {
    this.skills = loadSkills({
      cwd: this.cwd,
      agentDir: this.root,
      includeDefaults: false,
      skillPaths: [...this.paths('skills'), ...this.additionalSkills]
    })
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
                  [...global.servers, ...project.servers].map((server) => [server.name, server])
                ).values()
              ],
              autoEnableCodemode: project.autoEnableCodemode ?? global.autoEnableCodemode,
              errors: [...global.errors, ...project.errors]
            }
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
    if (loaded.extensions.some((extension) => extension.tools.has('ask_user_question'))) {
      throw new Error('ask_user_question 是 eli 保留的工具名')
    }
    this.extensions = { extensions: [...extensions, ...loaded.extensions], errors: [], runtime }
    this.loadSkills()
    this.loadPrompts()
    // 全局说明在前；从文件系统根到工作目录依次应用 AGENTS.md，不扫描其他工具的配置目录。
    const ancestors: string[] = []
    for (let dir = resolve(this.cwd); ; dir = dirname(dir)) {
      ancestors.unshift(dir)
      if (dirname(dir) === dir) break
    }
    this.agentsFiles = [
      ...new Set([
        join(this.root, 'AGENTS.md'),
        ...ancestors.map((dir) => join(dir, 'AGENTS.md')),
        join(this.cwd, '.eli', 'AGENTS.md')
      ])
    ].flatMap((path) => {
      const content = readOptional(path)
      return content ? [{ path, content }] : []
    })
    this.systemSource = [join(this.cwd, '.eli', 'SYSTEM.md'), join(this.root, 'SYSTEM.md')].find(
      existsSync
    )
    this.systemPrompt = this.systemSource
      ? readOptional(this.systemSource)
      : 'You are eli, a desktop coding assistant. Help the user complete tasks using the available tools. Follow the user and project instructions. Inspect relevant files before changing them, make focused changes, verify results, and report clearly. Your settings, credentials and resources are managed by eli in ~/.eli and the workspace .eli directory.'
    this.appendPrompts = [
      join(this.root, 'APPEND_SYSTEM.md'),
      join(this.cwd, '.eli', 'APPEND_SYSTEM.md')
    ].flatMap((path) => {
      const content = readOptional(path)
      return content ? [{ path, content }] : []
    })
  }
}
