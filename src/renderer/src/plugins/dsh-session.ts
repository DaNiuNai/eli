import type { Context } from '@deepseek-ai/cordis'
import type {
  StandardSourceBinding,
  SlotScopeAdapter,
  HostObservable
} from '@deepseek-ai/dsh-client-ui-slots'
import type { AgentSnapshot } from '../../../shared/agent'
import { shareSnapshot } from '../lib/share-snapshot'

interface Observable<T> extends HostObservable<T> {
  getSnapshot(): T
  subscribe(fn: () => void): () => void
  set(next: T): void
  observed(): boolean
}
function observable<T>(initial: T): Observable<T> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    subscribe(fn: () => void) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    getSnapshot: () => value,
    set(next: T) {
      if (Object.is(value, next)) return
      value = next
      for (const listener of listeners) listener()
    },
    observed: () => listeners.size > 0
  }
}
interface SessionState {
  sessionId?: string
  running: boolean
  blank: boolean
  pendingSubmissions: never[]
  subagent: null
  removed: boolean
  openState: 'open' | 'error' | 'loading'
  openError: { code: string; message: string | null } | null
  hasMore: boolean
  loadingOlder: boolean
  promptError: null
  lastAgentError: string | null
  promptAttempted: boolean
  awaitingFirstTurn: boolean
}
function sessionState(snapshot: AgentSnapshot): SessionState {
  return {
    sessionId: snapshot.session?.sessionId,
    running: snapshot.running,
    blank: snapshot.messages.length === 0,
    pendingSubmissions: [],
    subagent: null,
    removed: false,
    openState:
      snapshot.connection === 'ready'
        ? 'open'
        : snapshot.connection === 'error'
          ? 'error'
          : 'loading',
    openError:
      snapshot.connection === 'error' ? { code: 'internal', message: snapshot.error } : null,
    hasMore: false,
    loadingOlder: false,
    promptError: null,
    lastAgentError: snapshot.error,
    promptAttempted: snapshot.messages.length > 0 || snapshot.running,
    awaitingFirstTurn: snapshot.pending && !snapshot.messages.length
  }
}

export function installSessionScope(ctx: Context): void {
  const absent: StandardSourceBinding = {
    key: undefined,
    hooks: { session: undefined },
    keyedHooks: { projection: undefined },
    props: { sessionId: undefined }
  }
  const current = observable(absent)
  const absentSource = observable(absent)
  const state = observable<ReturnType<typeof sessionState> | undefined>(undefined)
  const sources = new Map<string, ReturnType<typeof projectionSource>>()
  let selected: string | undefined
  let sessionKey = ''
  let revision = -1
  let active = true

  function projectionSource(
    key: string
  ): Pick<Observable<unknown>, 'subscribe' | 'getSnapshot'> & { refresh(): Promise<void> } {
    const values = observable<unknown>(undefined)
    const owner = sessionKey
    let loading = false
    let dirty = false
    async function refresh(): Promise<void> {
      if (!active || !values.observed() || owner !== sessionKey) return
      if (loading) {
        dirty = true
        return
      }
      loading = true
      try {
        do {
          dirty = false
          const next = await window.plugins.projection(owner, key)
          if (active && owner === sessionKey) values.set(shareSnapshot(values.getSnapshot(), next))
        } while (dirty && active && owner === sessionKey && values.observed())
      } catch {
        values.set(undefined)
      } finally {
        loading = false
      }
    }
    return {
      getSnapshot: values.getSnapshot,
      subscribe(fn: () => void) {
        const dispose = values.subscribe(fn)
        void refresh()
        return dispose
      },
      refresh
    }
  }
  const adapter: SlotScopeAdapter = {
    current,
    bindingSource: (target) =>
      target && (target as { sessionId?: string }).sessionId === selected ? current : absentSource,
    renderArea: (value, props) => (value.key ? props.children : (props.empty?.() ?? null))
  }
  ctx.slots.installScope('session', adapter)
  const publish = (next: AgentSnapshot): void => {
    if (!active || next.revision < revision) return
    revision = next.revision
    const id = next.session?.sessionId
    state.set(id ? shareSnapshot(state.getSnapshot(), sessionState(next)) : undefined)
    if (selected !== id || sessionKey !== next.sessionKey) {
      sources.clear()
      selected = id
      sessionKey = next.sessionKey
      current.set(
        id
          ? ({
              key: id,
              ctx,
              hooks: { session: state },
              keyedHooks: {
                projection: (key) => {
                  let source = sources.get(key)
                  if (!source) {
                    source = projectionSource(key)
                    sources.set(key, source)
                  }
                  return source
                }
              },
              props: { sessionId: id }
            } as StandardSourceBinding)
          : absent
      )
      activeSessionId.set(id)
    }
    for (const source of sources.values()) void source.refresh()
  }
  ctx.effect(() => window.api.onSnapshot(publish))
  void window.api.connect().then(publish, () => {})
  ctx.effect(() => () => {
    active = false
    sources.clear()
    current.set(absent)
    activeSessionId.set(undefined)
  })
}
export const activeSessionId = observable<string | undefined>(undefined)
