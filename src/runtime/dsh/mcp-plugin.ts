import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { Type } from 'typebox'
import type { Plugin } from '@deepseek-ai/cordis'
import { toLlmContent } from '@earendil-works/pi-mcp'
import { EliConfigStore } from '../../config/store'
import { managedMcpServers } from '../mcp'
import { McpOAuthCredentialStore, McpServerConnection, mcpNamespace } from '../mcp-transport'
import type { McpServerDefinition } from '../../shared/mcp'

/** MCP 连接与工具注册均归插件所有；卸载会等待全部传输关闭。 */
export const mcpPlugin: Plugin = {
  inject: ['eli', 'tools', 'attachments', 'eliTools', 'systemPrompt'],
  async apply(ctx) {
    const { root, cwd, models } = ctx.eli
    const configured = new Map<string, McpServerDefinition>()
    for (const directory of [root, join(cwd, '.eli')]) {
      try {
        const file = JSON.parse(await readFile(join(directory, 'mcp.json'), 'utf8'))
        for (const server of await managedMcpServers(file.mcpServers ?? file.servers))
          configured.set(server.name, server)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      if (directory === root)
        for (const server of await managedMcpServers(
          (await new EliConfigStore(join(root, 'config.json')).read()).mcpServers
        ))
          configured.set(server.name, server)
    }
    const tools = ctx.eliTools.using(ctx)
    const connections = new Map<string, McpServerConnection>()
    for (const server of configured.values()) {
      if (server.config.enabled === false) continue
      const connection = new McpServerConnection({
        entry: server,
        cwd,
        credentials: new McpOAuthCredentialStore(
          join(root, 'mcp-auth.json'),
          join(root, 'mcp-locks')
        ),
        providerToken: async (provider) => (await models.runtime.getAuth(provider))?.auth.apiKey
      })
      ctx.effect(() => () => connection.close())
      try {
        await connection.getClient()
      } catch (error) {
        throw new Error(`MCP ${server.name} 连接失败，请在设置中检查连接或完成认证`, {
          cause: error
        })
      }
      connections.set(server.name, connection)
      const client = await connection.getClient()
      if (client.instructions)
        ctx.systemPrompt.section({
          name: `mcp.${server.name}`,
          order: 200,
          text: client.instructions,
          interpolate: false
        })
      for (const tool of connection.tools) {
        const exposure =
          server.config.toolExposure?.[tool.name] ?? server.config.exposure ?? 'direct'
        if (exposure === 'hidden') continue
        tools.registerTool({
          name: `${mcpNamespace(server.name)}__${tool.name}`,
          description: tool.description ?? tool.name,
          exposure,
          parameters: Type.Unsafe<Record<string, unknown>>(tool.inputSchema),
          annotations: tool.annotations,
          async execute(_id, args, signal) {
            const result = await connection.callTool(tool.name, args, { signal })
            return {
              content: toLlmContent(result),
              details: result.structuredContent,
              isError: result.isError
            }
          }
        })
      }
    }
    if (!connections.size) return
    for (const templates of [false, true])
      tools.registerTool({
        name: templates ? 'list_mcp_resource_templates' : 'list_mcp_resources',
        description: templates ? '列出 MCP 服务的资源 URI 模板。' : '列出 MCP 服务可读取的资源。',
        annotations: { readOnlyHint: true },
        parameters: Type.Object({
          server: Type.Optional(Type.String()),
          cursor: Type.Optional(Type.String())
        }),
        async execute(_id, args, signal) {
          const selected = args.server
            ? [connections.get(args.server)].filter((item) => !!item)
            : [...connections.values()]
          if (args.server && !selected.length) throw new Error('MCP 服务不存在')
          const resources = await Promise.all(
            selected.map(async (connection) => {
              const client = await connection.getClient()
              if (!client.serverCapabilities?.resources) return undefined
              const page = templates
                ? await client.listResourceTemplatesPage(args.cursor, { signal })
                : await client.listResourcesPage(args.cursor, { signal })
              return { server: connection.entry.name, ...page }
            })
          )
          return { content: [{ type: 'text', text: JSON.stringify(resources.filter(Boolean)) }] }
        }
      })
    tools.registerTool({
      name: 'read_mcp_resource',
      description: '读取指定 MCP 服务的资源 URI。',
      annotations: { readOnlyHint: true },
      parameters: Type.Object({ server: Type.String(), uri: Type.String() }),
      async execute(_id, args, signal) {
        const connection = connections.get(args.server)
        if (!connection) throw new Error('MCP 服务不存在')
        const result = await (await connection.getClient()).readResource(args.uri, { signal })
        return { content: [{ type: 'text', text: JSON.stringify(result) }] }
      }
    })
  }
}
