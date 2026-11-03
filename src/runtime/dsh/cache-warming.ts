import type { Plugin } from '@deepseek-ai/cordis'
import { isAgentLoopRequest, type GenerateOptions, type TokenUsage } from '@deepseek-ai/dsh-llm'
import { appendPluginRecord } from '@deepseek-ai/dsh-session'
import { calculateCost, type Model, type Api, type Usage } from '@earendil-works/pi-ai'
import { auxiliaryRequest } from '../request-body'

interface WarmUsage {
  provider: string
  model: string
  usage: TokenUsage
  cost: number
}
declare module '@deepseek-ai/dsh-session' {
  interface PluginRecordMap {
    'plugin:eli/cache-warm': WarmUsage
  }
}

function price(model: Model<Api>, input = 0, cacheRead = 0, cacheWrite = 0, output = 0): number {
  const usage: Usage = {
    input,
    cacheRead,
    cacheWrite,
    output,
    totalTokens: input + cacheRead + cacheWrite + output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  }
  return calculateCost(model, usage).total
}

/** 复用原请求前缀。只在模型声明缓存期限且预计节省抵得过本次请求时预热。 */
export const cacheWarming: Plugin = {
  inject: ['llm', 'eli', 'agents'],
  apply(ctx) {
    const mode = ctx.eli.settings.getSettings().cacheWarming ?? 'streaming'
    if (mode === 'off') return
    let timer: ReturnType<typeof setTimeout> | undefined
    let controller: AbortController | undefined
    const pending = new Set<Promise<void>>()
    const cancel = (): void => {
      clearTimeout(timer)
      controller?.abort()
      controller = undefined
    }
    ctx.on('agent/status', ({ status }) => {
      if (status === 'idle' && mode === 'streaming') cancel()
    })
    ctx.on('session/event', (_session, event) => {
      if (event.type === 'model/selection') cancel()
    })
    ctx.on('llm/stream', (request, next) => {
      if (!isAgentLoopRequest(request) || !request.sessionId) return next()
      cancel()
      const agent = ctx.agents.get(request.sessionId)
      const model = ctx.eli.models.runtime.getModel(request.provider, request.model)
      const ttl = (model?.promptCache?.short ?? 0) * 1000
      if (
        !agent ||
        !model ||
        ttl <= 10000 ||
        (model.api === 'anthropic-messages' &&
          request.reasoningEffort &&
          request.reasoningEffort !== 'off' &&
          !(
            model.compat &&
            'forceAdaptiveThinking' in model.compat &&
            model.compat.forceAdaptiveThinking
          ))
      )
        return next()
      const run = new AbortController()
      controller = run
      const started = Date.now()
      const delay = Math.min(ttl * 0.9, ttl - 10000)
      const refresh = async (deadline: number): Promise<void> => {
        const idle = agent.status === 'idle'
        if (
          run.signal.aborted ||
          Date.now() > deadline ||
          Date.now() - started >= (idle ? 30 : 60) * 60000
        )
          return
        const entry = agent.session
          .snapshotEvents()
          .findLast((event) => event.type === 'assistant/message' && event.data.usage !== undefined)
        const usage = entry?.type === 'assistant/message' ? entry.data.usage : undefined
        if (!usage) return
        const tokens =
          usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
        const miss = model.cost.cacheWrite > 0 ? price(model, 0, 0, tokens) : price(model, tokens)
        const savings =
          (idle ? 0.15 : 1) * (miss - price(model, 0, tokens)) - price(model, 0, tokens, 0, 1)
        if (savings < 0.05) return
        const replay: GenerateOptions = { ...request, maxTokens: 1, signal: run.signal }
        let measured: TokenUsage | undefined
        await auxiliaryRequest(async () => {
          for await (const chunk of ctx.llm.stream(replay)) {
            if (chunk.type === 'usage') measured = chunk.usage
            if (
              chunk.type === 'finish' &&
              (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')
            )
              return
          }
          if (!measured || run.signal.aborted) return
          appendPluginRecord(agent.session, 'plugin:eli/cache-warm', {
            provider: model.provider,
            model: model.id,
            usage: measured,
            cost: price(
              model,
              measured.inputTokens,
              measured.cacheReadTokens,
              measured.cacheWriteTokens,
              measured.outputTokens
            )
          })
          schedule()
        })
      }
      const schedule = (): void => {
        if (run.signal.aborted) return
        const deadline = Date.now() + ttl
        timer = setTimeout(() => {
          const job = refresh(deadline).catch(() => {
            /* 预热失败不会重试或中断用户会话。 */
          })
          pending.add(job)
          void job.finally(() => pending.delete(job))
        }, delay)
        timer.unref()
      }
      schedule()
      return next()
    })
    ctx.effect(() => async () => {
      cancel()
      await Promise.allSettled(pending)
    })
  }
}
