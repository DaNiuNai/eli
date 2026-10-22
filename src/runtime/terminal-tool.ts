import {
  createBashToolDefinition,
  createLocalBashOperations,
  createLocalPowerShellOperations,
  createPowerShellToolDefinition,
  getPowerShellConfig,
  type BashOperations,
  type ExtensionAPI
} from '@earendil-works/pi-coding-agent'
import type { TerminalPreference } from '../shared/terminal'

/** 只覆盖 eli 的进程内工具，执行、截断、超时和取消仍由 pi 自带的后端处理。 */
export function configureTerminal(
  pi: ExtensionAPI,
  cwd: string,
  terminal: TerminalPreference
): void {
  const active = pi.getActiveTools()
  const powershell = terminal.kind === 'powershell'
  let operations: BashOperations = createLocalBashOperations({ shellPath: terminal.path })
  if (powershell) {
    // pi 的 PowerShell 后端会自动优先选择 pwsh；显式选择其他路径时使用其
    // 可指定路径的 Shell 后端。PowerShell 同样支持 -c，保留内置工具的 UTF-8 输出。
    let automaticPath: string | undefined
    if (process.platform === 'win32') {
      try {
        automaticPath = getPowerShellConfig().shell.toLowerCase()
      } catch {
        // 自定义安装不一定在系统搜索路径中，仍使用已验证的显式路径。
      }
    }
    if (automaticPath === terminal.path.toLowerCase()) {
      operations = createLocalPowerShellOperations()
    } else {
      const shellOperations = operations
      operations = {
        exec: (command, directory, options) =>
          shellOperations.exec(
            `try { [Console]::OutputEncoding=[System.Text.Encoding]::UTF8 } catch {}\n${command}`,
            directory,
            options
          )
      }
    }
  }
  const tool = powershell
    ? createPowerShellToolDefinition(cwd, { operations })
    : createBashToolDefinition(cwd, {
        operations,
        commandPrefix: pi.getSettings().shellCommandPrefix
      })
  pi.registerTool({ ...tool, defaultActive: false })
  // 保留其余工具及用户显式禁用 Shell 的设置，只替换已有的 Shell 工具。
  pi.setActiveTools([
    ...active.filter((name) => name !== 'bash' && name !== 'powershell'),
    ...(active.some((name) => name === 'bash' || name === 'powershell') ? [tool.name] : [])
  ])
}
