import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import type { SubagentTeam } from './subagents'

export const subagentToolNames = new Set([
  'spawn_agent',
  'send_message',
  'followup_task',
  'interrupt_agent',
  'list_agents',
  'wait_agent'
])

export function registerSubagentTools(pi: ExtensionAPI, team: SubagentTeam, caller: string): void {
  pi.on('before_agent_start', (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${team.instructions(caller)}`
  }))
  const target = Type.String({ minLength: 1, maxLength: 4096, description: 'Agent 名称或完整路径' })
  const message = Type.String({ minLength: 1, maxLength: 100000 })
  const result = (
    value: unknown
  ): { content: { type: 'text'; text: string }[]; details: unknown } => ({
    content: [{ type: 'text', text: JSON.stringify(value) }],
    details: value
  })
  pi.registerTool({
    name: 'spawn_agent',
    label: '创建子 Agent',
    description:
      '仅在用户明确要求使用子 Agent，或已有提示词明确指示使用子 Agent 时，才可调用。不得仅因任务复杂、适合并行或模型自行判断而开启。若认为适合委派，应先向用户建议并取得明确同意，不得先创建后告知。创建并启动子 Agent，立即返回名称，任务在后台并行执行。默认继承全部对话、模型、工具与工作目录；fork_turns="none" 使用独立上下文，可指定模型与思考强度。所有层级共用最多 4 个并发槽位（含主 Agent）。子 Agent 完成后自动报告父 Agent。',
    parameters: Type.Object({
      task_name: Type.String({
        pattern: '^[a-z][a-z0-9_]{0,63}$',
        description: '唯一的简短任务名'
      }),
      message,
      fork_turns: Type.Optional(Type.Union([Type.Literal('all'), Type.Literal('none')])),
      model: Type.Optional(
        Type.String({
          minLength: 1,
          maxLength: 600,
          description: 'provider/modelId；仅独立上下文可覆盖'
        })
      ),
      reasoning_effort: Type.Optional(
        Type.Union([
          Type.Literal('off'),
          Type.Literal('minimal'),
          Type.Literal('low'),
          Type.Literal('medium'),
          Type.Literal('high'),
          Type.Literal('xhigh'),
          Type.Literal('max')
        ])
      )
    }),
    async execute(_id, input) {
      return result(await team.spawn(caller, input))
    }
  })
  for (const [name, label, wake] of [
    ['send_message', '发送协作消息', false],
    ['followup_task', '追加子 Agent 任务', true]
  ] as const) {
    pi.registerTool({
      name,
      label,
      description: wake
        ? '向已有非主 Agent 追加任务。空闲时启动新一轮，运行中在消息边界收到任务。保留成员已有上下文。'
        : '向团队成员发送协作消息。运行中的成员在消息边界收到消息；空闲成员只保存消息，不启动新一轮。',
      parameters: Type.Object({ target, message }),
      async execute(_id, input) {
        return result(team.send(caller, input.target, input.message, wake))
      }
    })
  }
  pi.registerTool({
    name: 'interrupt_agent',
    label: '中断子 Agent',
    description:
      '中断指定成员及其后代的当前任务，返回之前状态。保留成员与历史，可用 followup_task 继续；不能中断自己或祖先。',
    parameters: Type.Object({ target }),
    async execute(_id, input) {
      return result(await team.interrupt(caller, input.target))
    }
  })
  pi.registerTool({
    name: 'list_agents',
    label: '查看 Agent 团队',
    description:
      '列出当前会话的所有子 Agent（包括已完成成员），返回名称、父成员、任务、状态、模型与结果。可按路径前缀筛选。',
    annotations: { readOnlyHint: true },
    parameters: Type.Object({ path_prefix: Type.Optional(Type.String({ maxLength: 4096 })) }),
    async execute(_id, input) {
      return result(
        team.list(input.path_prefix).map(({ snapshot, ...agent }) => ({
          ...agent,
          model: snapshot?.model,
          activity: snapshot?.activity,
          approvalCount: snapshot?.toolApprovals.length ?? 0,
          questionCount: snapshot?.userQuestions.length ?? 0
        }))
      )
    }
  })
  pi.registerTool({
    name: 'wait_agent',
    label: '等待 Agent 消息',
    description:
      '等待发给当前 Agent 的消息、完成报告或中断通知。已有未读通知则立即返回；普通进度更新不会唤醒。默认等待 30 秒，建议使用较长等待避免反复轮询。',
    annotations: { readOnlyHint: true },
    parameters: Type.Object({
      timeout_ms: Type.Optional(Type.Integer({ minimum: 10000, maximum: 3600000 }))
    }),
    async execute(_id, input, signal) {
      return result(await team.wait(caller, input.timeout_ms, signal))
    }
  })
}
