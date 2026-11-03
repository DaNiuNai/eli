import { builtinBundle } from '../../shared/plugin-bundles'
import { extname } from 'node:path'
import { Type } from 'typebox'
import { Value } from 'typebox/value'
import type { Plugin } from '@deepseek-ai/cordis'
import type { RuntimeInteractions } from '../interactions'
import type { BackgroundTasks } from '../background-tasks'
import type { SubagentTeam } from '../subagents'
import type { TerminalPreference } from '../../shared/terminal'
import type { PluginEntry } from '../../shared/plugins'
import { FeatureTools } from './tools'
import { configureTerminal } from '../terminal-tool'
import { registerSubagentTools, subagentToolNames } from '../subagent-tools'
import type { EliResourceLoader } from '../resources'
import { mcpPlugin } from './mcp-plugin'
import { discoveryPlugin } from './discovery'
import { applyReplacements, diffDetails } from './file-edits'

export interface FeatureBindings {
  interactions: RuntimeInteractions
  createTasks(): BackgroundTasks
  createTeam(): SubagentTeam
  ownsTeam: boolean
  caller: string
  terminal: TerminalPreference
  resources: EliResourceLoader
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    eliTools: FeatureTools
    eliFeatures: FeatureBindings
    eliTasks: BackgroundTasks
    eliTeam: SubagentTeam
    eliApprovals: RuntimeInteractions
  }
}

const questionParameters = Type.Object({
  questions: Type.Array(
    Type.Object({
      header: Type.String({ minLength: 1, maxLength: 12 }),
      question: Type.String({ minLength: 1, maxLength: 2000 }),
      multiSelect: Type.Boolean(),
      options: Type.Array(
        Type.Object({
          label: Type.String({ minLength: 1, maxLength: 200 }),
          description: Type.String({ minLength: 1, maxLength: 2000 }),
          preview: Type.Optional(Type.String({ minLength: 1, maxLength: 20000 }))
        }),
        { minItems: 2, maxItems: 4 }
      )
    }),
    { minItems: 1, maxItems: 4 }
  )
})

export const featureProfile: PluginEntry[] = builtinBundle('features')

export function featurePlugins(bindings: FeatureBindings): Readonly<Record<string, Plugin>> {
  return {
    'eli.mcp': mcpPlugin,
    'eli.discovery': discoveryPlugin,
    'eli.feature-services': {
      inject: ['eli', 'tools'],
      apply(ctx) {
        ctx.provide('eliFeatures', bindings)
        ctx.provide('eliTools', new FeatureTools(ctx, ctx.eli.cwd, ctx.eli.settings.getSettings()))
      }
    },
    'eli.instructions': {
      inject: ['systemPrompt', 'eliFeatures'],
      apply(ctx) {
        ctx.systemPrompt.section({
          name: 'eli.instructions',
          order: 0,
          text: () => ctx.eliFeatures.resources.getSystemPrompt(),
          interpolate: false
        })
        ctx.systemPrompt.section({
          name: 'eli.media-guidance',
          order: 100,
          text: '需要查看大量图片时，优先将多张图片拼成总览图再读取，并将每张总览图保存为小于 1 MB 的 JPG 文件；需要查看细节时再按需读取原图。',
          interpolate: false
        })
      }
    },
    'eli.terminal': {
      inject: ['tools', 'attachments', 'eliTools', 'eliFeatures', 'eli'],
      apply(ctx) {
        ctx.once('agent/created', () => {
          const tasks = ctx.eliFeatures.createTasks()
          ctx.provide('eliTasks', tasks)
          ctx.effect(() => () => tasks.close())
          configureTerminal(ctx.eliTools.using(ctx), ctx.eli.cwd, ctx.eliFeatures.terminal, tasks)
          return undefined
        })
      }
    },
    'eli.questions': {
      inject: ['tools', 'attachments', 'eliTools', 'eliFeatures'],
      apply(ctx) {
        ctx.eliTools.using(ctx).registerTool({
          name: 'ask_user_question',
          label: '询问用户',
          description:
            '仅在需要用户决定时提问。一次 1–4 题，每题 2–4 个互斥选项；可多选。用户可自由输入，不要重复提供“其他”。推荐项放在首位并标注。支持 Markdown preview。等待真实答复后继续。',
          parameters: questionParameters,
          executionMode: 'sequential',
          annotations: { readOnlyHint: true },
          async execute(id, args, signal) {
            const reply = await ctx.eliFeatures.interactions.ask(id, args, signal)
            return {
              content: [{ type: 'text', text: reply.text }],
              details: { answers: reply.answers }
            }
          }
        })
      }
    },
    'eli.subagents': {
      inject: ['tools', 'attachments', 'eliTools', 'eliFeatures', 'systemPrompt'],
      apply(ctx) {
        const { caller, ownsTeam } = ctx.eliFeatures
        const team = ctx.eliFeatures.createTeam()
        ctx.provide('eliTeam', team)
        if (ownsTeam) ctx.effect(() => () => team.close())
        registerSubagentTools(ctx.eliTools.using(ctx), team, caller)
        ctx.systemPrompt.section({
          name: 'eli.collaboration',
          order: 50,
          text: team.instructions(caller),
          interpolate: false
        })
      }
    },
    'eli.approvals': {
      inject: ['tools', 'eliTools', 'eliFeatures'],
      apply(ctx) {
        const interactions = ctx.eliFeatures.interactions
        ctx.provide('eliApprovals', interactions)
        let batch: string | undefined
        let batchReady: Promise<void> | undefined
        ctx.on('session/event', (_session, event) => {
          if (event.type === 'turn/end') {
            batch = undefined
            batchReady = undefined
            interactions.clearPrefetchedApprovals()
          }
        })
        ctx.on('tools/pre-execute', async (execution, next) => {
          const info = ctx.eliTools.definitions.get(execution.name)
          if (!execution.parent && info?.exposure === 'codemode')
            return { kind: 'deny', reason: '此工具只能从 run_code 调用' }
          if (info && !Value.Check(info.parameters, execution.arguments))
            return { kind: 'deny', reason: '工具参数不符合 Schema' }
          if (execution.name === 'ask_user_question' || subagentToolNames.has(execution.name))
            return next()
          const readOnly = (name: string): boolean =>
            ['read', 'grep', 'find', 'ls'].includes(name) ||
            ctx.eliTools.definitions.get(name)?.annotations?.readOnlyHint === true
          if (!execution.parent && interactions.canPrefetchApprovals && execution.agent) {
            const event = execution.agent.session
              .snapshotEvents()
              .findLast((entry) => entry.type === 'assistant/message')
            if (event?.type === 'assistant/message' && batch !== event.data.message.id) {
              batch = event.data.message.id
              const calls = event.data.message.content.filter((block) => block.type === 'tool-call')
              if (
                calls.length > 1 &&
                !calls.some(
                  (call) => ctx.eliTools.definitions.get(call.name)?.executionMode === 'sequential'
                )
              ) {
                interactions.prefetchApprovals(
                  calls.flatMap((call) => {
                    if (subagentToolNames.has(call.name) || call.name === 'ask_user_question')
                      return []
                    try {
                      const input: unknown = JSON.parse(call.arguments)
                      if (!input || typeof input !== 'object' || Array.isArray(input)) return []
                      const definition = ctx.eliTools.definitions.get(call.name)
                      if (definition && !Value.Check(definition.parameters, input)) return []
                      return [
                        {
                          request: {
                            toolCallId: call.id,
                            toolName: call.name,
                            input: input as Record<string, unknown>,
                            description: definition?.description
                          },
                          readOnly: readOnly(call.name)
                        }
                      ]
                    } catch {
                      return []
                    }
                  }),
                  execution.signal
                )
                batchReady = interactions.waitPrefetchedApprovals()
              }
            }
          }
          await batchReady
          if (
            !execution.arguments ||
            typeof execution.arguments !== 'object' ||
            Array.isArray(execution.arguments)
          )
            return { kind: 'deny', reason: '工具参数必须是对象' }
          const outcome = await interactions.approve(
            {
              toolCallId: execution.callId,
              toolName: execution.name,
              input: execution.arguments as Record<string, unknown>,
              description: info?.description,
              ...(execution.parent ? { parentToolCallId: execution.rootCallId } : {})
            },
            readOnly(execution.name),
            execution.signal
          )
          if (outcome.approved) return next()
          const reason = outcome.reason ?? '用户未批准此次工具调用，请等待用户进一步指示。'
          if (outcome.terminate) execution.agent?.cancel({ kind: 'hook', reason })
          return { kind: 'deny', reason }
        })
        ctx.effect(() => () => interactions.cancel())
      }
    },
    'eli.file-tools': {
      inject: ['tools', 'attachments', 'fs', 'eliTools', 'eli'],
      apply(ctx) {
        const tools = ctx.eliTools.using(ctx)
        const path = Type.String({ minLength: 1 })
        tools.registerTool({
          name: 'read',
          description:
            '读取文本文件或图片。文本可指定从 1 开始的 offset 和行数 limit；图片将作为视觉输入返回。',
          defaultActive: false,
          annotations: { readOnlyHint: true },
          parameters: Type.Object({
            path,
            offset: Type.Optional(Type.Integer({ minimum: 1 })),
            limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10000 }))
          }),
          async execute(_id, input, signal) {
            const target = await ctx.fs.resolve(input.path, { cwd: ctx.eli.cwd, signal })
            const imageTypes: Record<string, string> = {
              '.png': 'image/png',
              '.jpg': 'image/jpeg',
              '.jpeg': 'image/jpeg',
              '.webp': 'image/webp',
              '.gif': 'image/gif'
            }
            const mimeType = imageTypes[extname(input.path).toLowerCase()]
            if (mimeType)
              return {
                content: [
                  {
                    type: 'image',
                    mimeType,
                    data: Buffer.from(
                      await ctx.fs.readBytes(target, signal, 50 * 1024 * 1024)
                    ).toString('base64')
                  }
                ]
              }
            const text = await ctx.fs.readText(target, signal)
            const lines = text.split('\n')
            const start = (input.offset ?? 1) - 1
            const selected = lines.slice(start, start + (input.limit ?? 2000)).join('\n')
            return {
              content: [
                {
                  type: 'text',
                  text:
                    selected.slice(0, 100000) +
                    (start + (input.limit ?? 2000) < lines.length
                      ? `\n[后续内容请使用 offset 继续读取，共 ${lines.length} 行]`
                      : '')
                }
              ]
            }
          }
        })
        tools.registerTool({
          name: 'write',
          description: '创建或覆盖 UTF-8 文本文件。',
          defaultActive: false,
          parameters: Type.Object({ path, content: Type.String() }),
          async execute(_id, input, signal) {
            const target = await ctx.fs.resolve(input.path, { cwd: ctx.eli.cwd, signal })
            const result = await ctx.fs.writeText(target, input.content, undefined, signal)
            return {
              content: [{ type: 'text', text: `已写入 ${input.path}` }],
              details: diffDetails(input.path, result.before, result.after)
            }
          }
        })
        tools.registerTool({
          name: 'edit',
          description:
            '用 edits 数组一次应用多处精确替换。每项 oldText 必须在原文件中唯一匹配，范围不能重叠。也接受单组 oldText/newText。',
          defaultActive: false,
          parameters: Type.Object({
            path,
            edits: Type.Optional(
              Type.Array(
                Type.Object({ oldText: Type.String({ minLength: 1 }), newText: Type.String() }),
                { minItems: 1 }
              )
            ),
            oldText: Type.Optional(Type.String({ minLength: 1 })),
            newText: Type.Optional(Type.String())
          }),
          async execute(_id, input, signal) {
            const target = await ctx.fs.resolve(input.path, { cwd: ctx.eli.cwd, signal })
            const edits = [...(input.edits ?? [])]
            if (input.oldText !== undefined || input.newText !== undefined) {
              if (!input.oldText || input.newText === undefined)
                throw new Error('oldText 和 newText 必须成对提供')
              edits.push({ oldText: input.oldText, newText: input.newText })
            }
            const info = await ctx.fs.stat(target, signal)
            if (!info || info.type !== 'file') throw new Error('待编辑文件不存在')
            const before = await ctx.fs.readText(target, signal)
            const after = applyReplacements(before, edits)
            await ctx.fs.writeText(
              target,
              after,
              { kind: 'replaceIfVersion', version: info.version },
              signal
            )
            return {
              content: [{ type: 'text', text: `已修改 ${input.path}` }],
              details: diffDetails(input.path, before, after)
            }
          }
        })
        tools.registerTool({
          name: 'ls',
          description: '列出目录的直接子项。',
          defaultActive: false,
          annotations: { readOnlyHint: true },
          parameters: Type.Object({ path: Type.Optional(path) }),
          async execute(_id, input, signal) {
            const target = await ctx.fs.resolve(input.path ?? '.', { cwd: ctx.eli.cwd, signal })
            const items = await ctx.fs.listDir(target, signal)
            return {
              content: [
                {
                  type: 'text',
                  text: items
                    .map((item) => `${item.name}${item.type === 'directory' ? '/' : ''}`)
                    .join('\n')
                }
              ]
            }
          }
        })
      }
    }
  }
}
