import type { Plugin } from '@deepseek-ai/cordis'
import { PtcExecutor } from '@deepseek-ai/dsh-tool-executor-ptc'
import { NativeToolExecutor } from '@deepseek-ai/dsh-tool-executor-native'
import NodePtcRuntime from '@deepseek-ai/dsh-ptc-runtime-node'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import LocalSandbox from '@deepseek-ai/dsh-sandbox-local'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import {
  RUN_CODE_NAME,
  ToolBatchExecutionError,
  type ToolBatchResult,
  type ToolExecutor
} from '@deepseek-ai/dsh-tools'

/** on 允许直接工具与 run_code 共存；only 使用 dsh 原生 PTC 执行器。两者共享审批流水线。 */
const programExecutor: Plugin<{ mode?: 'on' | 'only'; inlineBudget?: number }> = {
  inject: ['tools', 'systemPrompt', 'ptcRuntime', 'workingDirectory', 'sandboxPolicy'],
  apply(ctx, config) {
    if (config.mode !== undefined && config.mode !== 'on' && config.mode !== 'only')
      throw new Error('Codemode 配置无效')
    const ptc = new PtcExecutor(ctx)
    const native = new NativeToolExecutor(ctx)
    const budget = config.inlineBudget ?? 3000
    if (!Number.isSafeInteger(budget) || budget < 0)
      throw new Error('Codemode 描述预算必须为非负整数')
    const sections = ptc.sections
      .filter(({ name }) => config.mode === 'only' || name !== 'tools:ptc-only')
      .map((section) => ({
        ...section,
        text:
          typeof section.text === 'string'
            ? section.text
            : ((render) => (definitions: Parameters<typeof render>[0]) => {
                const full = render(definitions)
                if (full.length <= budget * 4) return full
                return `可用程序工具：${definitions.map(({ name }) => name).join(', ')}。使用 tool_search 查看参数，通过 await tools.<name>(args) 调用。`
              })(section.text)
      }))
    const executor: ToolExecutor = {
      sections,
      describe(definitions) {
        const program = ptc.describe(definitions)
        if (config.mode === 'only') return program
        const visible = definitions.filter(
          (definition) =>
            ctx.get('eliTools')?.definitions.get(definition.name)?.exposure !== 'codemode'
        )
        return {
          schemas: [...native.describe(visible).schemas, ...program.schemas],
          knownNames: [...definitions.map(({ name }) => name), RUN_CODE_NAME]
        }
      },
      async execute(input) {
        if (config.mode === 'only') return ptc.execute(input)
        const results: ToolBatchResult['results'][number][] = []
        const additionalContexts: ToolBatchResult['additionalContexts'][number][] = []
        let concluded = false
        let start = 0
        while (start < input.calls.length) {
          const program = input.calls[start].name === RUN_CODE_NAME
          let end = start + 1
          while (end < input.calls.length && (input.calls[end].name === RUN_CODE_NAME) === program)
            end++
          try {
            const outcome = await (program ? ptc : native).execute({
              ...input,
              calls: input.calls.slice(start, end)
            })
            results.push(...outcome.results)
            additionalContexts.push(...outcome.additionalContexts)
            concluded ||= outcome.concluded
          } catch (cause) {
            if (cause instanceof ToolBatchExecutionError) {
              results.push(...cause.partial.results)
              additionalContexts.push(...cause.partial.additionalContexts)
              concluded ||= cause.partial.concluded
            }
            throw new ToolBatchExecutionError(cause, { results, additionalContexts, concluded })
          }
          start = end
        }
        return { results, additionalContexts, concluded }
      }
    }
    ctx.tools.setExecutor(executor)
  }
}

export const programPlugins: Readonly<Record<string, Plugin>> = {
  'dsh.subprocess': LocalSubprocess,
  'dsh.sandbox': LocalSandbox,
  'dsh.sandbox-policy': SandboxPolicy,
  'dsh.working-directory': WorkingDirectory,
  'dsh.program-runtime': NodePtcRuntime,
  'eli.program-executor': programExecutor
}
