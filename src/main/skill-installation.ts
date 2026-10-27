import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { gte, valid } from 'semver'
import type { CommonSkillsInstallResult } from '../shared/skills'

const executeFile = promisify(execFile)
type VersionCommand = (file: string, args: string[]) => Promise<string>

const runVersion: VersionCommand = async (file, args) => {
  const { stdout } = await executeFile(file, args, {
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 4096,
    windowsHide: true
  })
  return stdout
}

/** 检测系统命令，不能用 Electron 内置的 Node.js 版本代替。 */
export async function checkSkillInstallRequirements(
  platform = process.platform,
  run: VersionCommand = runVersion
): Promise<boolean> {
  const versions = await Promise.all(
    ['node', 'npm', 'npx'].map(async (command) => {
      try {
        // Windows 的 npm/npx 是 cmd 脚本，避免依赖 PowerShell 的脚本执行策略。
        const output =
          platform === 'win32' && command !== 'node'
            ? await run('cmd.exe', ['/d', '/s', '/c', `${command}.cmd --version`])
            : await run(platform === 'win32' ? 'node.exe' : command, ['--version'])
        return valid(output.trim())
      } catch {
        return null
      }
    })
  )
  return versions.every((version) => version !== null) && gte(versions[0]!, '22.20.0')
}

export const commonSkillsInstallPrompt = [
  '请帮我安装以下六个常用 Skill，安装为用户级，供 eli 的所有项目共用。请实际执行安装，不要只提供操作说明。',
  '用户的网络可能无法访问 nodejs.org、npm registry 或 GitHub。遇到连接失败、下载超时等网络问题时，请主动诊断网络、代理和镜像可用性，尝试可访问的可信下载源或临时 registry 参数，解决后继续安装，不要仅要求用户自行处理网络。优先使用临时配置，保持 HTTPS 证书校验；仍无法解决时，报告具体原因和已尝试的方法。',
  '依次执行以下命令；-g 表示用户级安装，-a pi 将 Skill 安装到 eli 可发现的 ~/.agents/skills，-y 避免交互式选择。',
  'npx --yes skills add https://github.com/vercel-labs/skills --skill find-skills -g -a pi -y',
  ...['skill-creator', 'pdf', 'pptx', 'docx', 'xlsx'].map(
    (skill) =>
      `npx --yes skills add https://github.com/anthropics/skills --skill ${skill} -g -a pi -y`
  ),
  'Windows 下如遇 PowerShell 脚本执行策略限制，请使用 npx.cmd 执行相同命令。',
  '完成后检查上述六个 Skill 的 SKILL.md 是否存在，逐项报告安装结果；如果失败，请说明原因，不要将失败报告为成功。',
  '最后提醒我回到“设置 → Skill 管理”点击“重新加载”。'
].join('\n')

interface SkillInstallationOptions {
  openExternal: (url: string) => Promise<void>
  startSession: (prompt: string) => Promise<void>
  checkRequirements?: () => Promise<boolean>
}

export class SkillInstallationService {
  private pending?: Promise<CommonSkillsInstallResult>

  constructor(private readonly options: SkillInstallationOptions) {}

  install(): Promise<CommonSkillsInstallResult> {
    if (this.pending) return this.pending
    this.pending = this.start().finally(() => {
      this.pending = undefined
    })
    return this.pending
  }

  private async start(): Promise<CommonSkillsInstallResult> {
    if (!(await (this.options.checkRequirements ?? checkSkillInstallRequirements)())) {
      try {
        await this.options.openExternal('https://nodejs.org/')
      } catch {
        throw new Error(
          '无法打开 Node.js 官网，请访问 https://nodejs.org/ 下载安装，完成后重启应用。'
        )
      }
      return 'node-required'
    }
    await this.options.startSession(commonSkillsInstallPrompt)
    return 'started'
  }
}
