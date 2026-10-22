export type TerminalKind = 'powershell' | 'bash' | 'zsh' | 'sh'

export interface TerminalPreference {
  kind: TerminalKind
  path: string
}

export interface TerminalOption extends TerminalPreference {
  label: string
}

export interface TerminalDiscovery {
  options: TerminalOption[]
  defaultTerminal: TerminalPreference
}

export interface TerminalApi {
  discover(): Promise<TerminalDiscovery>
  validate(path: string): Promise<TerminalPreference>
}

export const terminalChannels = {
  discover: 'terminal:discover',
  validate: 'terminal:validate'
} as const

export function defaultTerminal(platform: string): TerminalPreference {
  if (platform === 'win32') return { kind: 'powershell', path: 'powershell.exe' }
  if (platform === 'darwin') return { kind: 'zsh', path: '/bin/zsh' }
  return { kind: 'bash', path: '/bin/bash' }
}

export function parseTerminalPreference(value: unknown): TerminalPreference | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('无效的终端设置')
  const { kind, path } = value as Record<string, unknown>
  if (typeof kind !== 'string' || !['powershell', 'bash', 'zsh', 'sh'].includes(kind)) {
    throw new Error('无效的终端类型')
  }
  if (typeof path !== 'string' || !path.trim() || /[\r\n\0]/.test(path)) {
    throw new Error('请输入终端可执行文件路径')
  }
  return { kind: kind as TerminalKind, path: path.trim() }
}
