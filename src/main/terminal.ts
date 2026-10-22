import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import {
  defaultTerminal,
  type TerminalDiscovery,
  type TerminalKind,
  type TerminalOption,
  type TerminalPreference
} from '../shared/terminal'

const executeFile = promisify(execFile)

function terminalKind(path: string): TerminalKind | null {
  const name = basename(path)
    .replace(/\.exe$/i, '')
    .toLowerCase()
  if (name === 'powershell' || name === 'pwsh') return 'powershell'
  return name === 'bash' || name === 'zsh' || name === 'sh' ? name : null
}

async function executable(path: string): Promise<boolean> {
  try {
    if (!(await stat(path)).isFile()) return false
    await access(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function locate(name: string): Promise<string[]> {
  try {
    const { stdout } = await executeFile(
      process.platform === 'win32' ? 'where.exe' : 'which',
      process.platform === 'win32' ? [name] : ['-a', name],
      { encoding: 'utf8', timeout: 5000, windowsHide: true }
    )
    return stdout.trim().split(/\r?\n/).filter(isAbsolute)
  } catch {
    return []
  }
}

export async function validateTerminal(path: unknown): Promise<TerminalPreference> {
  if (typeof path !== 'string' || !path.trim() || /[\r\n\0]/.test(path)) {
    throw new Error('请输入终端可执行文件路径')
  }
  const expanded = path.trim().replace(/^~(?=$|[\\/])/, homedir())
  const kind = terminalKind(expanded)
  if (!kind) throw new Error('请选择 powershell、pwsh、bash、zsh 或 sh 可执行文件')
  const candidates = isAbsolute(expanded)
    ? [expanded]
    : basename(expanded) === expanded
      ? await locate(expanded)
      : []
  for (const candidate of candidates) {
    if (await executable(candidate)) return { kind, path: resolve(candidate) }
  }
  throw new Error('终端可执行文件不存在或不可执行')
}

export async function resolveTerminal(
  preference: TerminalPreference | null
): Promise<TerminalPreference> {
  return validateTerminal((preference ?? defaultTerminal(process.platform)).path)
}

export async function discoverTerminals(): Promise<TerminalDiscovery> {
  const windows = process.platform === 'win32'
  const names = ['powershell', 'pwsh', 'zsh', 'bash', 'sh']
  const located = await Promise.all(names.map((name) => locate(windows ? `${name}.exe` : name)))
  const candidates = located.flat()
  if (windows) {
    for (const git of await locate('git.exe')) {
      candidates.push(join(dirname(git), '..', 'bin', 'bash.exe'))
      candidates.push(join(dirname(git), '..', 'usr', 'bin', 'bash.exe'))
    }
  } else {
    for (const directory of ['/bin', '/usr/bin', '/usr/local/bin', '/opt/homebrew/bin']) {
      for (const name of names) candidates.push(join(directory, name))
    }
  }
  const options: TerminalOption[] = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    const path = resolve(candidate)
    const key = windows ? path.toLowerCase() : path
    const kind = terminalKind(path)
    if (seen.has(key) || !kind || !(await executable(path))) continue
    seen.add(key)
    const label =
      kind === 'powershell'
        ? /^pwsh/i.test(basename(path))
          ? 'PowerShell 7+'
          : 'Windows PowerShell'
        : kind
    options.push({ kind, path, label })
  }
  const preferred = defaultTerminal(process.platform)
  const resolvedDefault = await resolveTerminal(null).catch(() => preferred)
  options.sort((a, b) => {
    if (a.path === resolvedDefault.path) return -1
    if (b.path === resolvedDefault.path) return 1
    return a.label.localeCompare(b.label) || a.path.localeCompare(b.path)
  })
  return { options, defaultTerminal: resolvedDefault }
}
