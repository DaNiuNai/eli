import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { TSchema, Static } from 'typebox'
import { Value } from 'typebox/value'
import type { ImageContent, TextContent } from '@earendil-works/pi-ai'
import type { AgentSettings } from '../../shared/agent-config'
import { toBlocks } from './messages'

export interface ToolResult<T = unknown> {
  content: (TextContent | ImageContent)[]
  details?: T
  structuredContent?: unknown
  isError?: boolean
}

export interface ToolDefinition<T extends TSchema = TSchema> {
  name: string
  label?: string
  description: string
  promptSnippet?: string
  promptGuidelines?: string[]
  parameters: T
  defaultActive?: boolean
  exposure?: 'codemode' | 'deferred' | 'direct'
  executionMode?: 'sequential' | 'parallel'
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean }
  execute(
    id: string,
    args: Static<T>,
    signal: AbortSignal,
    update: (value: ToolResult) => void,
    context: { cwd: string }
  ): Promise<ToolResult>
}

/** 业务工具的 TypeBox 边界；执行、作用域、并发与撤销全部交给 dsh.tools。 */
export class FeatureTools {
  private active: Set<string>
  readonly definitions: Map<
    string,
    Pick<
      ToolDefinition,
      'name' | 'description' | 'parameters' | 'annotations' | 'executionMode' | 'exposure'
    >
  >
  constructor(
    readonly ctx: Context,
    private readonly cwd: string,
    private readonly settings: AgentSettings,
    shared?: FeatureTools
  ) {
    const requested = settings.defaultTools ?? ['read', 'bash', 'edit', 'write']
    const names = requested.some((name) => /^[+-]/.test(name))
      ? new Set(['read', 'bash', 'edit', 'write'])
      : new Set(requested)
    for (const name of requested) {
      if (name.startsWith('+')) names.add(name.slice(1))
      if (name.startsWith('-')) names.delete(name.slice(1))
    }
    this.active = shared?.active ?? names
    this.definitions = shared?.definitions ?? new Map()
  }

  using(ctx: Context): FeatureTools {
    return new FeatureTools(ctx, this.cwd, this.settings, this)
  }

  getActiveTools(): string[] {
    return [...this.active]
  }
  setActiveTools(names: string[]): void {
    this.active.clear()
    for (const name of names) this.active.add(name)
  }
  getSettings(): AgentSettings {
    return this.settings
  }

  registerTool<T extends TSchema>(tool: ToolDefinition<T>): void {
    if (this.definitions.has(tool.name)) throw new Error(`工具已注册：${tool.name}`)
    this.definitions.set(tool.name, tool)
    if (tool.defaultActive !== false) this.active.add(tool.name)
    this.ctx.effect(() => () => {
      this.definitions.delete(tool.name)
      this.active.delete(tool.name)
    })
    this.ctx.on('tools/execute', async (execution, next) => {
      const result = await next()
      if (
        execution.name !== tool.name ||
        result.isError ||
        !(result.value as { isError?: boolean })?.isError
      )
        return result
      return {
        isError: true,
        content: result.content,
        ...(result.meta === undefined ? {} : { meta: result.meta }),
        error: {
          message: result.content
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join('\n')
        }
      }
    })
    this.ctx.effect(() =>
      this.ctx.tools.register(
        {
          name: tool.name,
          description: tool.description,
          ...(tool.exposure === 'deferred' ? { deferLoading: true as const } : {}),
          parameters: JSON.parse(JSON.stringify(tool.parameters)),
          isConcurrencySafe: () => tool.executionMode !== 'sequential',
          output: {
            schema: {
              type: 'object',
              properties: {
                content: { type: 'array', items: {} },
                details: {},
                isError: { type: 'boolean' }
              },
              required: ['content']
            },
            render: (_args, value): ContentBlock[] => JSON.parse(JSON.stringify(value)).content,
            presentationMeta: (_args, value) => (value as { details?: never }).details ?? null
          },
          execute: async (args, execution) => {
            if (!Value.Check(tool.parameters, args))
              throw new Error(`工具 ${tool.name} 的参数不符合 Schema`)
            const result = await tool.execute(
              execution.callId,
              args as Static<T>,
              execution.signal,
              () => {},
              { cwd: this.cwd }
            )
            const content = await toBlocks(
              {
                role: 'toolResult',
                toolCallId: execution.callId,
                toolName: tool.name,
                content: result.content,
                isError: false,
                timestamp: Date.now()
              },
              this.ctx.attachments
            )
            return JSON.parse(
              JSON.stringify({
                content,
                details: result.details ?? result.structuredContent,
                isError: result.isError ?? false
              })
            )
          }
        },
        { when: () => this.active.has(tool.name) }
      )
    )
  }
}
