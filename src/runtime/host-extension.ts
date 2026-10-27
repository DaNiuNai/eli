import type { AgentSession, ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { validateToolArguments } from '@earendil-works/pi-ai'
import { Type } from 'typebox'
import { configureTerminal } from './terminal-tool'
import type { TerminalPreference } from '../shared/terminal'
import type { RuntimeInteractions } from './interactions'
import type { BackgroundTasks } from './background-tasks'
import type { SubagentTeam } from './subagents'
import { registerSubagentTools, subagentToolNames } from './subagent-tools'

const questionParameters = Type.Object({
  questions: Type.Array(
    Type.Object({
      header: Type.String({ minLength: 1, maxLength: 12, description: '界面小胶囊的短标签' }),
      question: Type.String({ minLength: 1, maxLength: 2000, description: '完整、清楚的问题' }),
      multiSelect: Type.Boolean({ description: 'true 为多选，false 为单选' }),
      options: Type.Array(
        Type.Object({
          label: Type.String({ minLength: 1, maxLength: 200 }),
          description: Type.String({ minLength: 1, maxLength: 2000 }),
          preview: Type.Optional(
            Type.String({
              minLength: 1,
              maxLength: 20000,
              description: '仅单选可用的 Markdown 预览'
            })
          )
        }),
        { minItems: 2, maxItems: 4 }
      )
    }),
    { minItems: 1, maxItems: 4 }
  )
})

/** 使用 PI 的执行前钩子，直接调用、MCP 及 codemode 嵌套调用均经过审批。 */
export function hostExtension(
  interactions: RuntimeInteractions,
  terminal: TerminalPreference,
  getAgent: () => AgentSession['agent'],
  tasks: BackgroundTasks,
  collaboration?: { team: SubagentTeam; id: string }
): ExtensionFactory {
  return (pi) => {
    if (collaboration) registerSubagentTools(pi, collaboration.team, collaboration.id)
    let approvalBatchId: string | undefined
    const clearBatch = (): void => {
      approvalBatchId = undefined
      interactions.clearPrefetchedApprovals()
    }
    pi.on('turn_end', clearBatch)
    pi.on('agent_end', clearBatch)
    pi.on('session_start', (_event, ctx) => {
      clearBatch()
      configureTerminal(pi, ctx.cwd, terminal, tasks)
    })
    pi.registerTool({
      name: 'ask_user_question',
      label: '询问用户',
      description: `向用户展示可交互的选项卡片，并等待用户答复后继续。

什么时候用：只在被一个真正属于用户的决定卡住时使用。有惯例默认值的事情，或能自行查证的事实，应自行决定并说明，不要询问。

提问的形态：一次 1–4 个问题，每题 2–4 个选项。选项应互斥，除非 multiSelect 为 true。用户永远可以选“其他”自由输入，不要把“其他”作为模型选项重复提供。若有推荐项，将它放在第一个，并在 label 末尾加“(推荐)”。header 是最多 12 字符的短标签，用作界面小胶囊。multiSelect 为 true 表示多选，false 表示单选。

预览（preview）：需要直观对比具体产物时，如 ASCII 界面草图、实现代码、图表方案或配置示例，可为选项提供 Markdown preview。至少一个选项有 preview 时，界面显示左右分栏对比，预览使用等宽框。简单偏好问题不要用 preview；preview 只支持单选。工具返回用户选择、自定义答案，以及选中选项的预览。`,
      promptSnippet: '询问真正需要用户决定的问题，展示单选或多选卡片并等待答复。',
      parameters: questionParameters,
      executionMode: 'sequential',
      annotations: { readOnlyHint: true },
      async execute(toolCallId, params, signal) {
        const reply = await interactions.ask(toolCallId, params, signal)
        return {
          content: [{ type: 'text', text: reply.text }],
          details: { answers: reply.answers }
        }
      }
    })
    pi.on('tool_call', async (event, ctx) => {
      // 提问本身等待用户作答，不需要再弹一次工具审批。
      if (event.toolName === 'ask_user_question') return undefined
      // 协作只调度本会话的成员；成员实际执行的工具仍逐次经过自己的审批。
      if (collaboration && subagentToolNames.has(event.toolName)) return undefined
      const tools = pi.getAllTools()
      if (!event.parentToolCallId && interactions.canPrefetchApprovals) {
        const entry = ctx.sessionManager
          .getBranch()
          .findLast((entry) => entry.type === 'message' && entry.message.role === 'assistant')
        if (
          entry?.type === 'message' &&
          entry.message.role === 'assistant' &&
          entry.id !== approvalBatchId
        ) {
          approvalBatchId = entry.id
          const agent = getAgent()
          const calls = entry.message.content.filter((part) => part.type === 'toolCall')
          const current = calls.findIndex((call) => call.id === event.toolCallId)
          // 串行工具可能获取新的用户授权，后面的调用须等它执行后再审核。
          if (
            current >= 0 &&
            calls.length - current > 1 &&
            agent.toolExecution === 'parallel' &&
            !calls.some(
              (call) =>
                agent.state.tools.find((tool) => tool.name === call.name)?.executionMode ===
                'sequential'
            )
          ) {
            const requests = calls.slice(current).flatMap((call) => {
              if (collaboration && subagentToolNames.has(call.name)) return []
              const tool = agent.state.tools.find((tool) => tool.name === call.name)
              if (!tool) return []
              try {
                const args = structuredClone(call.arguments)
                const input =
                  call.id === event.toolCallId
                    ? event.input
                    : validateToolArguments(tool, {
                        ...call,
                        arguments: tool.prepareArguments
                          ? (tool.prepareArguments(args) as typeof call.arguments)
                          : args
                      })
                const info = tools.find((tool) => tool.name === call.name)
                return [
                  {
                    request: {
                      toolCallId: call.id,
                      toolName: call.name,
                      input,
                      description: info?.description
                    },
                    readOnly:
                      ['read', 'grep', 'find', 'ls'].includes(call.name) ||
                      info?.annotations?.readOnlyHint === true
                  }
                ]
              } catch {
                // 无效参数由 pi 的原生准备流程报错，不为其创建审批。
                return []
              }
            })
            interactions.prefetchApprovals(requests, ctx.signal)
          }
        }
      }
      const tool = tools.find(({ name }) => name === event.toolName)
      const readOnly =
        ['read', 'grep', 'find', 'ls'].includes(event.toolName) ||
        tool?.annotations?.readOnlyHint === true
      const outcome = await interactions.approve(
        {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          input: event.input,
          description: tool?.description,
          ...(event.parentToolCallId ? { parentToolCallId: event.parentToolCallId } : {})
        },
        readOnly,
        ctx.signal
      )
      if (!outcome.approved) {
        return {
          block: true,
          reason: outcome.reason ?? '用户未批准此次工具调用，请等待用户进一步指示。',
          terminate: outcome.terminate ?? true
        }
      }
      return undefined
    })
  }
}
