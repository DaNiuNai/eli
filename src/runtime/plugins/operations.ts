import type { Context } from '@deepseek-ai/cordis'
import type {
  RuntimeMethod,
  RuntimeMethods,
  RuntimeRequest,
  RuntimeInit,
  RuntimeMessage,
  RuntimeSessionState
} from '../../shared/runtime'

export interface RuntimeEnvironment {
  options: RuntimeInit
  emit(message: RuntimeMessage): void
  publish(libraryChanged?: boolean): void
}

type Handler<K extends RuntimeMethod> = (
  ...args: RuntimeMethods[K]['args']
) => RuntimeMethods[K]['result'] | Promise<RuntimeMethods[K]['result']>

export class RuntimeOperations {
  private readonly handlers = new Map<RuntimeMethod, (args: never) => unknown>()
  register<K extends RuntimeMethod>(ctx: Context, name: K, handler: Handler<K>): void {
    if (this.handlers.has(name)) throw new Error(`Runtime 操作已注册：${name}`)
    const call = (args: RuntimeMethods[K]['args']): ReturnType<Handler<K>> => handler(...args)
    this.handlers.set(name, call)
    ctx.effect(() => () => {
      if (this.handlers.get(name) === call) this.handlers.delete(name)
    })
  }
  async dispatch(request: RuntimeRequest): Promise<unknown> {
    const handler = this.handlers.get(request.method)
    if (!handler) throw new Error(`当前插件配置不支持操作：${request.method}`)
    return handler(request.args as never)
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    eliRuntime: RuntimeEnvironment
    operations: RuntimeOperations
    runtimeNetwork: object
    sessionView: { state(): RuntimeSessionState; abort(): Promise<void> }
  }
}
