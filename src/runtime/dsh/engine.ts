import { builtinBundle } from '../../shared/plugin-bundles'
import { join } from 'node:path'
import type { Context, Plugin } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { LlmError, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import * as Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import * as NativeTools from '@deepseek-ai/dsh-tool-executor-native'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import Compaction from '@deepseek-ai/dsh-compaction-basic'
import * as ImageOffload from '@deepseek-ai/dsh-compaction-image-offload'
import * as Retry from '@deepseek-ai/dsh-llm-retry'
import Attachments from '@deepseek-ai/dsh-attachment-local'
import FileSystem from '@deepseek-ai/dsh-fs-local'
import Commands from '@deepseek-ai/dsh-commands'
import { PiAiAdapter, type ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { PluginApplication } from '../../plugins/kernel'
import { pluginProfile, pluginResolver } from '../../plugins/config'
import type { PluginEntry } from '../../shared/plugins'
import { isolatedAuthContext, type EliModels } from '../models'
import type { RuntimeSettings } from '../settings'
import { compactionPolicy } from './compaction-policy'
import { cacheWarming } from './cache-warming'
import { EliConfigStore } from '../../config/store'

export function dshSessionRoot(root: string): string {
  return join(root, 'sessions', 'dsh')
}

export interface EngineEnvironment {
  root: string
  cwd: string
  models: EliModels
  settings: RuntimeSettings
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    eli: EngineEnvironment
    eliPiRoutes: { has(provider: string): boolean }
  }
}

interface AdapterLimits {
  maxRequestImageBytes: number
  requestImagePixelBudget: number
  requestImageMaxBytes: number
}
const modelAdapter: Plugin<AdapterLimits> = {
  name: 'eli-model-adapter',
  inject: ['llm', 'eli'],
  apply(ctx: Context, limits): void {
    for (const key of [
      'maxRequestImageBytes',
      'requestImagePixelBudget',
      'requestImageMaxBytes'
    ] as const) {
      if (!Number.isSafeInteger(limits[key]) || limits[key] < 1)
        throw new Error(`模型适配器 ${key} 必须是正整数`)
    }
    const { models, settings } = ctx.eli
    const config = settings.getSettings()
    const retryPolicy = resolveRetryPolicy(
      {
        mode: 'normal',
        maxRetries: config.retry?.enabled === false ? 0 : (config.retry?.maxRetries ?? 3),
        backoff: {
          initialDelayMs: config.retry?.baseDelayMs ?? 2000,
          maxDelayMs: config.retry?.maxAgentDelayMs ?? 60000
        }
      },
      'eli.agent.retry'
    )
    let profiles = new Map<string, ResolvedPiAiProviderProfile>()
    const refreshProfiles = (): void => {
      profiles = new Map()
      for (const provider of models.runtime.getProviders()) {
        if (models.preferences[provider.id]?.enabled === false) continue
        profiles.set(provider.id, {
          provider: provider.id,
          displayName: provider.name,
          piProvider: provider,
          modelErrors: new Map(),
          configuredMaxTokens: new Map(),
          streamIdleTimeoutMs: settings.getHttpIdleTimeoutMs() || 2147483647,
          ...limits,
          ...(config.retry?.provider?.timeoutMs === undefined
            ? {}
            : { timeoutMs: config.retry.provider.timeoutMs }),
          ...(config.thinkingBudgets ? { thinkingBudgets: config.thinkingBudgets } : {}),
          ...(config.transport ? { transport: config.transport } : {}),
          ...(config.websocketConnectTimeoutMs === undefined
            ? {}
            : { websocketConnectTimeoutMs: config.websocketConnectTimeoutMs }),
          retryPolicy
        })
      }
    }
    refreshProfiles()
    const adapter = new PiAiAdapter({
      profiles: () => profiles,
      resolveApiKey: async (provider) => {
        if (!(await models.runtime.checkAuth(provider)))
          throw new LlmError(`供应商 ${provider} 缺少可用凭据`, 'MISSING_CREDENTIAL')
        return undefined
      },
      auth: { credentials: models.credentials, authContext: isolatedAuthContext },
      resolveAttachments: () => ctx.get('attachments')
    })
    const registration = ctx.llm.registerAdapter([...profiles.keys()], adapter)
    ctx.provide('eliPiRoutes', { has: (provider: string) => profiles.has(provider) })
    ctx.effect(() => registration)
    ctx.effect(() =>
      models.subscribe(() => {
        refreshProfiles()
        registration.replace([...profiles.keys()])
      })
    )
  }
}

export const enginePlugins: Readonly<Record<string, Plugin>> = {
  'dsh.llm': LlmRuntime,
  'dsh.sessions': SessionStore,
  'dsh.projections': SessionProjections,
  'dsh.persistence': Persistence,
  'dsh.prompt': SystemPrompt,
  'dsh.tools': Tools,
  'dsh.native-tools': NativeTools,
  'dsh.agents': AgentRegistry,
  'dsh.agent-loop': AgentLoop,
  'dsh.token-meter': TokenMeter,
  'dsh.compaction': Compaction,
  'dsh.image-offload': ImageOffload,
  'dsh.retry': Retry,
  'dsh.attachments': Attachments,
  'dsh.filesystem': FileSystem,
  'dsh.commands': Commands,
  'eli.models': modelAdapter,
  'eli.compaction-policy': compactionPolicy,
  'eli.cache-warming': cacheWarming
}

export function engineProfile(environment: EngineEnvironment): PluginEntry[] {
  const compaction = environment.settings.getCompactionSettings()
  const preserveImageSize = environment.settings.getSettings().images?.autoResize === false
  return builtinBundle('engine').map((entry) => {
    if (entry.id === 'persistence')
      return { ...entry, config: { ...entry.config, root: dshSessionRoot(environment.root) } }
    if (entry.id === 'attachments')
      return {
        ...entry,
        config: {
          ...entry.config,
          dshHome: environment.root,
          ...(preserveImageSize
            ? {
                normalizedImageMaxDimension: 65535,
                normalizedImageMaxPixels: 64000000,
                normalizedImageMaxBytes: 50 * 1024 * 1024
              }
            : {})
        }
      }
    if (entry.id === 'models' && preserveImageSize)
      return {
        ...entry,
        config: {
          ...entry.config,
          requestImagePixelBudget: 64000000,
          requestImageMaxBytes: 50 * 1024 * 1024
        }
      }
    if (entry.id === 'compaction')
      return {
        ...entry,
        config: {
          ...entry.config,
          auto: compaction.enabled,
          headroomTokens: compaction.reserveTokens,
          retainTokens: compaction.keepRecentTokens,
          modelPolicies: Object.entries(
            environment.settings.getSettings().compaction?.modelOverrides ?? {}
          ).map(([route, policy]) => {
            const index = route.indexOf('/')
            if (index < 1 || index === route.length - 1)
              throw new Error('模型摘要配置需要 provider/model 格式')
            return {
              provider: route.slice(0, index),
              model: route.slice(index + 1),
              ...(policy.reserveTokens === undefined
                ? {}
                : { headroomTokens: policy.reserveTokens }),
              ...(policy.keepRecentTokens === undefined
                ? {}
                : { retainTokens: policy.keepRecentTokens })
            }
          })
        }
      }
    return entry
  })
}

export async function createEngine(
  environment: EngineEnvironment,
  extra: readonly PluginEntry[] = [],
  plugins: Readonly<Record<string, Plugin>> = {}
): Promise<PluginApplication> {
  const application = new PluginApplication()
  application.ctx.provide('eli', environment)
  const base = engineProfile(environment)
  const settings = environment.settings.getSettings()
  const mcp =
    (await new EliConfigStore(join(environment.root, 'config.json')).read()).mcpServers ?? {}
  const code =
    settings.codemode?.mode === 'only' ||
    settings.defaultTools?.some((name) => /^(?:\+)?(?:codemode|run_code)$/.test(name)) ||
    Object.values(mcp).some(
      (server) =>
        server.enabled !== false &&
        (server.exposure === 'codemode' ||
          Object.values(server.toolExposure ?? {}).includes('codemode'))
    )
  if (code) {
    base.splice(
      base.findIndex(({ id }) => id === 'tool-executor'),
      1,
      { id: 'subprocess', name: 'dsh.subprocess' },
      { id: 'sandbox', name: 'dsh.sandbox' },
      {
        id: 'sandbox-policy',
        name: 'dsh.sandbox-policy',
        config: { mode: 'workspace-write', workspaceRoot: environment.cwd }
      },
      {
        id: 'working-directory',
        name: 'dsh.working-directory',
        config: { defaultDirectory: environment.cwd }
      },
      { id: 'program-runtime', name: 'dsh.program-runtime', config: { executionMode: 'per-call' } },
      {
        id: 'tool-executor',
        name: 'eli.program-executor',
        config: {
          mode: settings.codemode?.mode ?? 'on',
          inlineBudget: settings.codemode?.inlineBudget ?? 3000
        }
      }
    )
  }
  const entries = await pluginProfile(environment.root, 'session', [...base, ...extra])
  const needsPrograms = entries.some(
    ({ name, disabled }) =>
      !disabled &&
      [
        'dsh.subprocess',
        'dsh.sandbox',
        'dsh.sandbox-policy',
        'dsh.working-directory',
        'dsh.program-runtime',
        'eli.program-executor'
      ].includes(name)
  )
  const optional = needsPrograms ? (await import('./programs')).programPlugins : {}
  await application.startProfile(
    () => pluginProfile(environment.root, 'session', [...base, ...extra]),
    pluginResolver(environment.root, { ...enginePlugins, ...optional, ...plugins })
  )
  return application
}
