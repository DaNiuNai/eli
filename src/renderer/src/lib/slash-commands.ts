import { Minimize2Icon, Settings2Icon, type LucideIcon } from 'lucide-react'
import type { PiApi, PiSnapshot } from '../../../shared/pi'

export interface SlashCommandSuggestion {
  name: string
  description?: string
}

export interface SlashCommandAvailability {
  snapshot: PiSnapshot | null
  busy: boolean
  commandPending: boolean
}

export interface SlashCommandContext extends SlashCommandAvailability {
  api: PiApi
  openSettings: () => void
}

export interface SlashCommandDefinition extends SlashCommandSuggestion {
  description: string
  icon: LucideIcon
  parameters: 'none' | 'optional' | 'required'
  argumentHint?: string
  // 未声明的条件表示不需要；纯界面命令可使用空对象。
  requirements: {
    session?: boolean
    connection?: boolean
    model?: boolean
    idle?: boolean
    workspace?: boolean
  }
  execute: (context: SlashCommandContext, args: string) => void | Promise<void>
}

export interface SlashCommandInvocation {
  command: SlashCommandDefinition
  args: string
}

/** 新增桌面端命令时在此注册；列表、补全、发送和可用条件共用这一份定义。 */
export const slashCommandRegistry: readonly SlashCommandDefinition[] = [
  {
    name: 'settings',
    description: '打开设置面板',
    icon: Settings2Icon,
    parameters: 'none',
    requirements: {},
    execute: ({ openSettings }) => openSettings()
  },
  {
    name: 'compact',
    description: '压缩当前对话的上下文',
    icon: Minimize2Icon,
    parameters: 'optional',
    argumentHint: '[压缩要求]',
    requirements: { session: true, connection: true, model: true, idle: true, workspace: true },
    execute: async ({ api, snapshot }, args) => {
      if (snapshot) await api.compact(snapshot.sessionKey, args || undefined)
    }
  }
]

export function matchSlashCommand(draft: string): SlashCommandInvocation | null {
  const match = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/.exec(draft.trim())
  if (!match) return null
  const command = slashCommandRegistry.find((entry) => entry.name === match[1])
  const args = match[2]?.trim() ?? ''
  if (!command || (command.parameters === 'none' && args)) return null
  return { command, args }
}

export function isCompleteSlashCommand(draft: string): boolean {
  const invocation = matchSlashCommand(draft)
  return !!invocation && (invocation.command.parameters !== 'required' || !!invocation.args)
}

export function canExecuteSlashCommand(
  { command, args }: SlashCommandInvocation,
  { snapshot, busy, commandPending }: SlashCommandAvailability
): boolean {
  const { requirements } = command
  if (commandPending || (command.parameters === 'required' && !args)) return false
  if (requirements.session && !snapshot?.session) return false
  if (requirements.connection && snapshot?.connection !== 'ready') return false
  if (requirements.idle && busy) return false
  if (
    requirements.workspace &&
    (!snapshot || snapshot.unavailableWorkspaces.includes(snapshot.cwd))
  )
    return false
  if (
    requirements.model &&
    !snapshot?.models.some(
      (model) => model.provider === snapshot.model?.provider && model.id === snapshot.model.id
    )
  )
    return false
  return true
}

export async function executeSlashCommand(
  invocation: SlashCommandInvocation,
  context: SlashCommandContext
): Promise<void> {
  await invocation.command.execute(context, invocation.args)
}

export interface SlashCommandQuery {
  query: string
  end: number
}

export function getSlashCommandQuery(
  draft: string,
  start: number,
  end: number
): SlashCommandQuery | null {
  if (start !== end || start < 1) return null
  const match = /^\/([^\s/]*)(?=\s|$)/.exec(draft)
  if (!match || start > match[0].length) return null
  return { query: draft.slice(1, start).toLowerCase(), end: match[0].length }
}

export function filterSlashCommands<T extends SlashCommandSuggestion>(
  commands: readonly T[],
  query: string
): T[] {
  return commands.filter(
    ({ name, description }) =>
      name.toLowerCase().includes(query) || description?.toLowerCase().includes(query)
  )
}

export function completeSlashCommand(draft: string, end: number, name: string): string {
  return `/${name}${draft.slice(end) || ' '}`
}
