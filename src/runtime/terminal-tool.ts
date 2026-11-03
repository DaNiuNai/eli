import type { FeatureTools, ToolResult as AgentToolResult } from './dsh/tools'
import { shellOperations } from './shell-operations'
import type { TerminalPreference } from '../shared/terminal'
import { Type } from 'typebox'
import { isTaskActive, type BackgroundTask } from '../shared/background-tasks'
import type { BackgroundTasks } from './background-tasks'

function taskResult(task: BackgroundTask): AgentToolResult<BackgroundTask> {
  const status = isTaskActive(task)
    ? '命令仍在后台运行。可以继续其他工作，稍后使用 get_task 查询；不要连续轮询。'
    : `命令已结束，状态：${task.status}，退出码：${task.exitCode ?? '无'}。`
  return {
    content: [
      {
        type: 'text' as const,
        text: `${status}\n任务 ID：${task.id}\n${task.output || '(暂无输出)'}${task.outputTruncated ? `\n[仅显示末尾输出，日志：${task.logPath}]` : ''}${task.logTruncated ? '\n[日志已达到 10 MiB 上限，后续输出仅保留末尾预览]' : ''}${task.error ? `\n${task.error}` : ''}`
      }
    ],
    details: task,
    structuredContent: { ...task },
    isError: !isTaskActive(task) && task.status !== 'completed'
  }
}

/** Shell 插件保留后台任务协议，进程生命周期独立于模型轮次。 */
export function configureTerminal(
  pi: FeatureTools,
  cwd: string,
  terminal: TerminalPreference,
  tasks: BackgroundTasks
): void {
  const active = pi.getActiveTools()
  const powershell = terminal.kind === 'powershell'
  const operations = shellOperations(terminal)
  const name = powershell ? 'powershell' : 'bash'
  pi.registerTool({
    name,
    label: name,
    defaultActive: false,
    description: `在当前工作目录执行 ${powershell ? 'PowerShell' : terminal.kind} 命令。不传 background 时默认最多等待 30 秒，未结束即返回后台任务 ID，命令继续运行。background: false 持续在前台等待命令结束，不自动转后台；background: true 立即返回任务 ID，在后台执行。耗时操作或服务应使用 background: true。用 get_task 查询状态和输出，list_tasks 查找任务，stop_task 停止任务。timeout 是整个命令的秒数上限，未提供则不限制运行时长。输出仅保留末尾 32768 字符，日志最多保存 10 MiB。`,
    promptSnippet: '执行命令；默认最多等待 30 秒后转后台，可显式选择持续前台或立即后台执行。',
    promptGuidelines: [
      '长期运行的命令使用 background: true。任务返回 running 只代表已启动，不能声称完成；先做其他工作，确需结果时再用 get_task 查询，避免连续轮询。'
    ],
    parameters: Type.Object({
      command: Type.String({ minLength: 1, maxLength: 100000 }),
      timeout: Type.Optional(
        Type.Number({
          exclusiveMinimum: 0,
          maximum: 2147483,
          description: '整个命令的运行超时（秒），省略表示不限时'
        })
      ),
      background: Type.Optional(
        Type.Boolean({
          description: 'true 立即后台执行；false 持续前台等待；省略时默认 30 秒后自动转后台'
        })
      ),
      yield_time_ms: Type.Optional(
        Type.Integer({
          minimum: 0,
          maximum: 30000,
          description:
            '未传 background 时返回前最多等待的毫秒数，默认 30000；显式设置 background 时忽略'
        })
      )
    }),
    async execute(_id, params, signal, _update, ctx) {
      return taskResult(
        await tasks.execute(
          operations,
          {
            ...params,
            yieldTimeMs: params.yield_time_ms,
            cwd: ctx.cwd || cwd,
            shell: terminal.path,
            prefix: powershell ? undefined : pi.getSettings().shellCommandPrefix
          },
          signal
        )
      )
    }
  })
  pi.registerTool({
    name: 'get_task',
    label: '查询后台任务',
    defaultActive: false,
    description: '立即获取当前会话后台任务的状态、退出码和最新末尾输出，不等待进程结束。',
    promptSnippet: '通过任务 ID 查询后台任务状态与输出。',
    annotations: { readOnlyHint: true },
    parameters: Type.Object({ task_id: Type.String() }),
    async execute(_id, { task_id }) {
      return taskResult(tasks.get(task_id))
    }
  })
  pi.registerTool({
    name: 'list_tasks',
    label: '列出后台任务',
    defaultActive: false,
    description:
      '列出当前会话最近 100 个命令任务及状态，包含运行中的后台任务；输出正文请用 get_task 获取。',
    promptSnippet: '列出当前会话的任务 ID 和状态。',
    annotations: { readOnlyHint: true },
    parameters: Type.Object({}),
    async execute() {
      const list = tasks.list().map(({ id, command, status, startedAt, finishedAt, exitCode }) => ({
        id,
        command,
        status,
        startedAt,
        finishedAt,
        exitCode
      }))
      return { content: [{ type: 'text', text: JSON.stringify(list) }], details: { tasks: list } }
    }
  })
  pi.registerTool({
    name: 'stop_task',
    label: '停止后台任务',
    defaultActive: false,
    description: '停止当前会话中指定的后台任务及其子进程。已结束的任务保持原状态。',
    promptSnippet: '停止指定后台任务及其子进程。',
    parameters: Type.Object({ task_id: Type.String() }),
    async execute(_id, { task_id }) {
      return taskResult(tasks.stop(task_id))
    }
  })
  // 保留其余工具及用户显式禁用 Shell 的设置，只替换已有的 Shell 工具。
  pi.setActiveTools([
    ...active.filter(
      (name) => !['bash', 'powershell', 'get_task', 'list_tasks', 'stop_task'].includes(name)
    ),
    ...(active.some((name) => name === 'bash' || name === 'powershell')
      ? [name, 'get_task', 'list_tasks', 'stop_task']
      : [])
  ])
}
