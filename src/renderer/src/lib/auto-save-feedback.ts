import type { AutoSaveState, AutoSaveStatus } from './auto-save'

interface SaveFailure {
  id: string
  error?: string
  retry: () => void
}

interface SaveEntry extends SaveFailure {
  owner: symbol
  status: AutoSaveStatus
}

interface FeedbackSnapshot {
  status: AutoSaveStatus | null
  failures: SaveFailure[]
}

/** 汇总设置保存状态；组件卸载后的提交仍可更新状态和重试。 */
export class AutoSaveFeedbackStore {
  private entries = new Map<string, SaveEntry>()
  private listeners = new Set<() => void>()
  private snapshot: FeedbackSnapshot = { status: null, failures: [] }

  getSnapshot = (): FeedbackSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  report(
    id: string,
    owner: symbol,
    state: Pick<AutoSaveState<unknown>, 'status' | 'error'>,
    retry: () => void
  ): void {
    // 同一设置重新挂载并修改后，旧组件的迟到结果不能覆盖新状态。
    if (state.status !== 'pending' && this.entries.get(id)?.owner !== owner) return
    if (state.status === 'saved') this.entries.delete(id)
    else this.entries.set(id, { id, owner, status: state.status, error: state.error, retry })
    const entries = [...this.entries.values()]
    const failures = entries
      .filter((entry) => entry.status === 'error')
      .map(({ id, error, retry }) => ({ id, error, retry }))
    this.snapshot = {
      status: failures.length
        ? 'error'
        : entries.some((entry) => entry.status === 'saving')
          ? 'saving'
          : entries.length
            ? 'pending'
            : 'saved',
      failures
    }
    for (const listener of this.listeners) listener()
  }
}

export const autoSaveFeedback = new AutoSaveFeedbackStore()
