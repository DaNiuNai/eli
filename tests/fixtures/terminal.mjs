/* eslint-disable @typescript-eslint/explicit-function-return-type -- JavaScript 测试夹具。 */
import { execFileSync } from 'node:child_process'

export function getPowerShellConfig() {
  for (const name of ['pwsh', 'powershell']) {
    try {
      const output = execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', [name], {
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore']
      })
      const shell = output.trim().split(/\r?\n/)[0]
      if (shell) return { shell }
    } catch {
      /* 尝试另一种已安装的 PowerShell。 */
    }
  }
  throw new Error('测试需要已安装的 PowerShell')
}
