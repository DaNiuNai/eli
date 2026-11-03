import { posix } from 'node:path'
import type { Plugin } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-fs'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import { Type } from 'typebox'

/** 只在配置启用时向模型暴露搜索工具，所有源文件访问通过可替换的 fs 服务。 */
export const discoveryPlugin: Plugin = {
  inject: ['eli', 'fs', 'tools', 'eliTools', 'attachments'],
  apply(ctx) {
    const tools = ctx.eliTools.using(ctx)
    const walk = async function* (
      path: string,
      signal: AbortSignal
    ): AsyncGenerator<{ path: string; target: FsTarget; size?: number }> {
      const root = await ctx.fs.resolve(path, { cwd: ctx.eli.cwd, signal })
      const rootInfo = await ctx.fs.stat(root, signal)
      if (rootInfo?.type === 'file') {
        yield { path, target: root, size: rootInfo.size }
        return
      }
      const directories = [{ path: '', target: root }]
      while (directories.length) {
        signal.throwIfAborted()
        const directory = directories.pop()!
        for (const entry of await ctx.fs.listDir(directory.target, signal)) {
          if (entry.name === '.git' || entry.name === 'node_modules') continue
          const path = posix.join(directory.path, entry.name)
          if (entry.type === 'directory') directories.push({ path, target: entry.target })
          else if (entry.type === 'file') yield { path, target: entry.target, size: entry.size }
        }
      }
    }
    const path = Type.Optional(Type.String())
    const limit = Type.Optional(Type.Integer({ minimum: 1, maximum: 10000 }))
    tools.registerTool({
      name: 'find',
      description: '按 glob 模式查找工作目录中的文件，返回相对路径。',
      annotations: { readOnlyHint: true },
      defaultActive: false,
      parameters: Type.Object({ pattern: Type.String({ minLength: 1 }), path, limit }),
      async execute(_id, args, signal) {
        const files: string[] = []
        for await (const file of walk(args.path ?? '.', signal)) {
          if (
            posix.matchesGlob(file.path, args.pattern) ||
            posix.matchesGlob(posix.basename(file.path), args.pattern)
          )
            files.push(file.path)
          if (files.length >= (args.limit ?? 1000)) break
        }
        return { content: [{ type: 'text', text: files.join('\n') || '没有匹配文件' }] }
      }
    })
    tools.registerTool({
      name: 'grep',
      description: '搜索文件内容，返回路径、行号及匹配行；支持正则、字面量和 glob 过滤。',
      annotations: { readOnlyHint: true },
      defaultActive: false,
      parameters: Type.Object({
        pattern: Type.String({ minLength: 1 }),
        path,
        glob: Type.Optional(Type.String()),
        ignoreCase: Type.Optional(Type.Boolean()),
        literal: Type.Optional(Type.Boolean()),
        limit
      }),
      async execute(_id, args, signal) {
        const expression = args.literal
          ? args.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          : args.pattern
        const matcher = new RegExp(expression, args.ignoreCase ? 'i' : '')
        const matches: string[] = []
        for await (const file of walk(args.path ?? '.', signal)) {
          if (
            args.glob &&
            !posix.matchesGlob(file.path, args.glob) &&
            !posix.matchesGlob(posix.basename(file.path), args.glob)
          )
            continue
          if ((file.size ?? 0) > 8 * 1024 * 1024) continue
          let text: string
          try {
            text = await ctx.fs.readText(file.target, signal)
          } catch (error) {
            if ((error as { code?: string }).code === 'FS_NOT_TEXT') continue
            throw error
          }
          for (const [index, line] of text.split(/\r?\n/).entries()) {
            if (matcher.test(line))
              matches.push(`${file.path}:${index + 1}: ${line.slice(0, 2000)}`)
            if (matches.length >= (args.limit ?? 100)) break
          }
          if (matches.length >= (args.limit ?? 100)) break
        }
        return { content: [{ type: 'text', text: matches.join('\n') || '没有匹配内容' }] }
      }
    })
    tools.registerTool({
      name: 'tool_search',
      description: '按关键字查找可用工具，获取名称、说明与参数 Schema。',
      annotations: { readOnlyHint: true },
      parameters: Type.Object({ query: Type.String(), limit }),
      async execute(_id, args) {
        const query = args.query.toLowerCase().trim().split(/\s+/)
        const active = new Set(tools.getActiveTools())
        const matches = [...tools.definitions.values()]
          .filter(
            (tool) =>
              active.has(tool.name) &&
              query.every((term) => `${tool.name} ${tool.description}`.toLowerCase().includes(term))
          )
          .slice(0, args.limit ?? 10)
          .map(({ name, description, parameters }) => ({ name, description, parameters }))
        return {
          content: [{ type: 'text', text: JSON.stringify(matches) }],
          details: { count: matches.length }
        }
      }
    })
  }
}
