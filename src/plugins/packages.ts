import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { resolve as resolveModule } from 'import-meta-resolve'
import semver from 'semver'
import { parseDocument } from 'yaml'
import { applyEntryPatches } from '@deepseek-ai/cordis-plugin-include'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import {
  parsePluginConfiguration,
  type ManagedPackage,
  type PluginProfile,
  type PluginPatch
} from '../shared/plugins'
import appManifest from '../../package.json' with { type: 'json' }

const execute = promisify(execFile)
const packageName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/
const dshVersion = appManifest.dependencies['@deepseek-ai/dsh-agent-loop']

/** Only data is inspected during installation. Plugin code is loaded by the target profile. */
function sourceSpec(input: string): string {
  if (
    !input ||
    input !== input.trim() ||
    input.length > 2048 ||
    [...input].some((char) => char.charCodeAt(0) < 32)
  )
    throw new Error('无效的插件来源')
  if (isAbsolute(input)) return 'file:' + input.replaceAll('\\', '/')
  if (/^(?:git\+)?https:\/\//.test(input)) {
    const url = new URL(input.replace(/^git\+/, ''))
    if (url.username || url.password || url.search)
      throw new Error('Git 地址不能包含凭据或查询参数')
    return 'git+' + url.href
  }
  const at = input.indexOf('@', 1)
  const name = at < 0 ? input : input.slice(0, at)
  if (!packageName.test(name) || (at >= 0 && !/^[0-9a-zA-Z.^~*+_-]+$/.test(input.slice(at + 1))))
    throw new Error('请输入 npm 包名、HTTPS Git 地址或本地包目录')
  return input
}

function moduleFile(name: string, anchor: string): string {
  const url = resolveModule(name, pathToFileURL(anchor).href)
  if (!url.startsWith('file:')) throw new Error('插件入口必须是本地文件')
  return fileURLToPath(url)
}

interface PackageManifest {
  name: string
  version: string
  description?: string
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  engines?: { dsh?: string }
  dsh?: { bundle?: { patch?: string }; client?: { platform?: string } }
}
async function manifest(directory: string): Promise<PackageManifest> {
  return JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
}

export class PluginPackages {
  readonly directory: string
  constructor(
    root: string,
    private readonly pnpm: string,
    private readonly registry?: string
  ) {
    this.directory = join(root, 'plugins', 'releases')
  }

  private async run(cwd: string, args: string[], signal?: AbortSignal): Promise<string> {
    try {
      const result = await execute(process.execPath, [this.pnpm, ...args], {
        cwd,
        windowsHide: true,
        timeout: 180000,
        maxBuffer: 4 * 1024 * 1024,
        signal,
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          CI: 'true',
          GIT_TERMINAL_PROMPT: '0',
          npm_config_manage_package_manager_versions: 'false',
          ...(this.registry ? { npm_config_registry: this.registry } : {})
        }
      })
      return result.stdout
    } catch (cause) {
      const error = cause as Error & { stderr?: string; stdout?: string }
      const diagnostic = (error.stderr || error.stdout || error.message).slice(-2400)
      throw new Error(diagnostic.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1'), { cause })
    }
  }

  async versions(name: string): Promise<string[]> {
    if (!packageName.test(name)) throw new Error('无效的包名')
    await mkdir(this.directory, { recursive: true })
    const value: unknown = JSON.parse(
      await this.run(this.directory, ['view', name, 'versions', '--json'])
    )
    return (Array.isArray(value) ? value : [value])
      .filter((v): v is string => typeof v === 'string' && !!semver.valid(v))
      .sort(semver.rcompare)
  }

  async stage(
    source: string,
    target: PluginProfile,
    signal?: AbortSignal
  ): Promise<ManagedPackage> {
    const spec = sourceSpec(source)
    const generation = randomUUID()
    const directory = join(this.directory, generation)
    await mkdir(directory, { recursive: true })
    try {
      await writeFile(join(directory, 'package.json'), '{"private":true}\n')
      await this.run(
        directory,
        [
          'add',
          '--ignore-workspace',
          '--ignore-scripts',
          '--save-exact',
          '--store-dir',
          join(this.directory, '..', 'store'),
          spec
        ],
        signal
      )
      const project = await manifest(directory)
      const names = Object.keys(project.dependencies ?? {})
      if (names.length !== 1 || !packageName.test(names[0])) throw new Error('安装未产生有效插件包')
      const installed = await realpath(join(directory, 'node_modules', names[0]))
      const info = await manifest(installed)
      if (info.name !== names[0] || !semver.valid(info.version))
        throw new Error('插件包名称或版本无效')
      const required = info.engines?.dsh ?? info.peerDependencies?.['@deepseek-ai/dsh-agent']
      if (required && !semver.satisfies(dshVersion, required, { includePrerelease: true }))
        throw new Error('该插件要求 dsh ' + required + '，当前版本为 ' + dshVersion)
      const pkg: ManagedPackage = {
        name: info.name,
        version: info.version,
        source,
        target,
        description: typeof info.description === 'string' ? info.description : '',
        generation,
        enabled: true,
        entries: {}
      }
      const anchor = join(installed, 'package.json')
      const insert = (profile: PluginProfile, row: PluginPatch): void => {
        ;(pkg.entries[profile] ??= []).push(row)
      }
      const addModule = async (
        id: string,
        name: string,
        row: PluginPatch,
        hosted = true
      ): Promise<void> => {
        const entry = moduleFile(name, anchor)
        ;(pkg.modules ??= {})[id] = name
        if (hosted && target !== 'client') insert(target, { ...row, id, name: entry })
        // dsh ships the host and browser halves as separate exports of the same package.
        let owner = dirname(entry)
        while (owner !== dirname(owner)) {
          const data = await manifest(owner).catch(() => undefined)
          if (data?.name) {
            if (data.dsh?.client) {
              insert('client', {
                ...row,
                id,
                name: moduleFile(data.name + '/client', join(owner, 'package.json'))
              })
            } else if (target === 'client' && hosted) insert(target, { ...row, id, name: entry })
            break
          }
          owner = dirname(owner)
        }
      }
      if (info.dsh?.bundle) {
        const patch = info.dsh.bundle.patch
        if (typeof patch !== 'string') throw new Error('无效的 dsh 组合包 patch')
        const file = await realpath(resolve(installed, patch))
        const within = relative(installed, file)
        if (within.startsWith('..') || isAbsolute(within))
          throw new Error('组合包 patch 越过包目录')
        const doc = parseDocument(await readFile(file, 'utf8'), {
          uniqueKeys: true,
          customTags: [
            {
              tag: 'tag:yaml.org,2002:js',
              resolve: (expression: string) => ({ __jsExpr: expression })
            }
          ]
        })
        if (doc.errors.length || doc.warnings.length)
          throw new Error('无法解析组合包 patch：' + [...doc.errors, ...doc.warnings][0]?.message)
        const operations: unknown = doc.toJS()
        if (!Array.isArray(operations)) throw new Error('组合包 patch 必须是列表')
        let rows: EntryOptions[] = []
        const insertedIds = new Set<string>()
        const visit = (row: EntryOptions): void => {
          if (!row || typeof row.id !== 'string' || typeof row.name !== 'string')
            throw new Error('无效的组合包条目')
          if (insertedIds.has(row.id)) throw new Error('组合包条目重复：' + row.id)
          insertedIds.add(row.id)
          if (row.group && Array.isArray(row.config)) row.config.forEach(visit)
        }
        for (const op of operations) {
          if (!op || typeof op !== 'object') throw new Error('无效的组合包操作')
          if (op.preset) throw new Error('未找到此组合包要求的 dsh Agent preset：' + op.preset)
          if (op.insert || insertedIds.has(op.id)) {
            if (op.insert) op.insert.forEach(visit)
            rows = applyEntryPatches(rows, [op], (message, ...args) => {
              throw new Error(message + ' ' + args.join(' '))
            })
          } else insert(target, op)
        }
        const clientRows = async (row: EntryOptions): Promise<void> => {
          if (row.disabled === true) return
          if (row.group && Array.isArray(row.config)) {
            for (const child of row.config) await clientRows(child)
          } else if (!row.name.startsWith('cordis:'))
            await addModule(row.id, row.name, { id: row.id }, false)
        }
        for (const row of rows) {
          if (
            row.group ||
            Object.keys(row).some((key) => !['id', 'name', 'config', 'disabled'].includes(key)) ||
            JSON.stringify(row).includes('"__jsExpr"') ||
            row.name.startsWith('cordis:')
          ) {
            if (target !== 'client')
              insert(target, {
                id: row.id,
                name: 'eli.dsh-tree',
                config: { anchor, entry: row },
                disabled: row.disabled === true
              })
            await clientRows(row)
          } else await addModule(row.id, row.name, row as PluginPatch)
        }
      } else {
        await addModule('pkg-' + info.name.replace(/[^a-z0-9._-]/g, '-'), info.name, { id: '' })
      }
      if (!Object.keys(pkg.entries).length) throw new Error('插件包没有声明任何条目')
      parsePluginConfiguration({ profiles: pkg.entries })
      return pkg
    } catch (error) {
      await this.discard(generation)
      throw error
    }
  }

  async discard(generation: string): Promise<void> {
    if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/.test(generation))
      throw new Error('无效的插件安装目录')
    const path = resolve(this.directory, generation)
    if (dirname(path) !== resolve(this.directory) || basename(path) !== generation)
      throw new Error('无效的插件安装目录')
    await rm(path, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 })
  }
}
