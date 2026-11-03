import { builtinBundle } from '../../shared/plugin-bundles'
import type { Plugin } from '@deepseek-ai/cordis'
import * as Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { RuntimeOperations } from './operations'
import { RuntimeCoordinator } from '../coordinator'
import { ProvidersService } from '../providers'
import { AgentLibraryService } from '../library'
import { AgentSettingsService } from '../settings-service'
import { AgentAuthService } from '../auth'
import { SkillsService } from '../skills'
import { McpService } from '../mcp'
import { closeNetwork } from '../network'
import { runtimePaths } from '../paths'
import { dshSessionRoot } from '../dsh/engine'
import { isToolApprovalMode } from '../../shared/tool-approval'
import { runtimeProtocolVersion, type RuntimeInit } from '../../shared/runtime'
import type { PluginEntry } from '../../shared/plugins'

declare module '@deepseek-ai/cordis' {
  interface Context {
    providers: ProvidersService
  }
}

export function runtimeProfile(options: RuntimeInit): PluginEntry[] {
  const common = builtinBundle('runtime')
  if (options.kind === 'session') return [...common, ...builtinBundle('session-host')]
  return [
    ...common,
    ...builtinBundle('control').map((entry) =>
      entry.id === 'persistence'
        ? { ...entry, config: { ...entry.config, root: dshSessionRoot(options.root) } }
        : entry
    )
  ]
}

export const runtimePlugins: Readonly<Record<string, Plugin>> = {
  'eli.runtime-operations': {
    apply(ctx) {
      ctx.provide('operations', new RuntimeOperations())
    }
  },
  'eli.runtime-network': {
    apply(ctx) {
      ctx.provide('runtimeNetwork', {})
      ctx.effect(() => () => closeNetwork())
    }
  },
  'dsh.persistence': Persistence,
  'eli.session': {
    inject: ['eliRuntime', 'operations', 'runtimeNetwork'],
    async apply(ctx) {
      const { options, publish } = ctx.eliRuntime
      if (options.kind !== 'session') throw new Error('会话插件只能在 session 配置中使用')
      if (
        typeof options.sessionKey !== 'string' ||
        !isToolApprovalMode(options.approvalMode) ||
        !options.terminal?.path
      )
        throw new Error('无效的会话配置')
      const session = new RuntimeCoordinator(options, publish)
      ctx.effect(() => () => session.dispose())
      await session.initialize()
      ctx.provide('sessionView', session)
      ctx.operations.register(ctx, 'prompt', (text) => {
        session.prompt(text)
        return session.state()
      })
      ctx.operations.register(ctx, 'compact', (instructions) => {
        session.compact(instructions)
        return session.state()
      })
      ctx.operations.register(ctx, 'abort', async () => {
        await session.abort()
        return session.state()
      })
      ctx.operations.register(ctx, 'stopBackgroundTask', (id) => {
        session.stopBackgroundTask(id)
        return session.state()
      })
      ctx.operations.register(ctx, 'controlSubagent', async (action) => {
        await session.controlSubagent(action)
        return session.state()
      })
      ctx.operations.register(ctx, 'setModel', async (provider, id) => {
        await session.setModel(provider, id)
        return session.state()
      })
      ctx.operations.register(ctx, 'setThinkingLevel', async (level) => {
        await session.setThinkingLevel(level)
        return session.state()
      })
      ctx.operations.register(ctx, 'editMessage', async (target, text) => {
        await session.editMessage(target, text)
        return session.state()
      })
      ctx.operations.register(ctx, 'forkMessage', (target) => session.forkMessage(target))
      ctx.operations.register(ctx, 'getSkills', () => session.getSkills())
      ctx.operations.register(ctx, 'configure', (mode) => {
        if (!isToolApprovalMode(mode)) throw new Error('无效的工具审批挡位')
        session.configure(mode)
      })
      ctx.operations.register(ctx, 'approve', (id, approved) =>
        session.respondApproval(id, approved)
      )
      ctx.operations.register(ctx, 'answer', (id, answers) => session.respondQuestion(id, answers))
    }
  },
  'eli.providers': {
    inject: ['eliRuntime', 'operations', 'runtimeNetwork'],
    apply(ctx) {
      const service = new ProvidersService(ctx.eliRuntime.options.root, () =>
        ctx.eliRuntime.emit({ version: runtimeProtocolVersion, kind: 'providers_changed' })
      )
      ctx.provide('providers', service)
      ctx.operations.register(ctx, 'getProviders', () => service.get())
      ctx.operations.register(ctx, 'changeProvider', (change) => service.change(change))
    }
  },
  'eli.library': {
    inject: ['eliRuntime', 'operations', 'sessionPersistence'],
    apply(ctx) {
      const service = new AgentLibraryService(
        runtimePaths(ctx.eliRuntime.options.root).sessions,
        ctx.sessionPersistence
      )
      ctx.operations.register(ctx, 'getLibrary', (version) => service.load(version))
      ctx.operations.register(ctx, 'findSession', (path) => service.findSession(path))
      ctx.operations.register(ctx, 'hasWorkspace', (cwd) => service.hasWorkspace(cwd))
    }
  },
  'eli.settings': {
    inject: ['eliRuntime', 'operations'],
    apply(ctx) {
      const service = new AgentSettingsService(ctx.eliRuntime.options.root)
      ctx.operations.register(ctx, 'getSettings', () => service.get())
      ctx.operations.register(ctx, 'saveSettings', (changes) => service.save(changes))
    }
  },
  'eli.skills': {
    inject: ['eliRuntime', 'operations'],
    apply(ctx) {
      const service = new SkillsService(ctx.eliRuntime.options.root)
      ctx.operations.register(ctx, 'getUserSkills', () => service.get())
      ctx.operations.register(ctx, 'setSkillEnabled', (path, enabled) =>
        service.setEnabled(path, enabled)
      )
    }
  },
  'eli.mcp': {
    inject: ['eliRuntime', 'operations', 'runtimeNetwork'],
    apply(ctx) {
      const { root, cwd } = ctx.eliRuntime.options
      const service = new McpService(root, cwd, (snapshot) =>
        ctx.eliRuntime.emit({ version: runtimeProtocolVersion, kind: 'mcp_auth', snapshot })
      )
      ctx.effect(() => () => service.close())
      ctx.operations.register(ctx, 'getMcpServers', () => service.get())
      ctx.operations.register(ctx, 'changeMcpServer', (change) => service.change(change))
      ctx.operations.register(ctx, 'testMcpServer', (name, cwd) => service.test(name, cwd))
      ctx.operations.register(ctx, 'getMcpAuth', () => service.getAuth())
      ctx.operations.register(ctx, 'startMcpAuth', (name, force) => service.startAuth(name, force))
      ctx.operations.register(ctx, 'signOutMcpAuth', (name) => service.signOut(name))
      ctx.operations.register(ctx, 'cancelMcpAuth', (id) => service.cancelAuth(id))
      ctx.operations.register(ctx, 'respondMcpAuth', (id, url) => service.respondAuth(id, url))
      ctx.operations.register(ctx, 'validateMcpAuthLink', (id) => service.validateAuthLink(id))
      ctx.operations.register(ctx, 'getMcpWebsite', (name) => service.website(name))
    }
  },
  'eli.auth': {
    inject: ['eliRuntime', 'operations', 'providers', 'runtimeNetwork'],
    apply(ctx) {
      const { options, emit } = ctx.eliRuntime
      const service = new AgentAuthService(
        options.root,
        (snapshot) => emit({ version: runtimeProtocolVersion, kind: 'auth', snapshot }),
        options.kind === 'control' && options.firstLaunch,
        ctx.providers
      )
      ctx.effect(() => () => service.dispose())
      ctx.operations.register(ctx, 'getAuth', () => service.get())
      ctx.operations.register(ctx, 'login', (id, type) => service.login(id, type))
      ctx.operations.register(ctx, 'respondLogin', (id, value) => service.respond(id, value))
      ctx.operations.register(ctx, 'cancelLogin', () => service.cancel())
      ctx.operations.register(ctx, 'validateAuthLink', (url) => service.validateLink(url))
    }
  }
}
