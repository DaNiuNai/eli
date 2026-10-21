import type { RpcClient } from '@earendil-works/pi-coding-agent'

export type CompactionOutcome = 'compacted' | 'cancelled' | 'too-small' | 'already-compacted'

export function compactionSkipReason(error: unknown): 'too-small' | 'already-compacted' | null {
  const message = (error instanceof Error ? error.message : String(error)).replace(
    /^Compaction failed: /,
    ''
  )
  if (message === 'Nothing to compact (session too small)') return 'too-small'
  if (message === 'Already compacted') return 'already-compacted'
  return null
}

/** 压缩可能超过 RpcClient 固定的 30 秒响应等待，结束事件仍可确认结果。 */
export function compactContext(
  client: RpcClient,
  instructions: string | undefined,
  signal: AbortSignal
): Promise<CompactionOutcome> {
  return new Promise((resolve, reject) => {
    let settled = false
    let checking = false
    const settle = (action: () => void): void => {
      if (settled) return
      settled = true
      clearInterval(heartbeat)
      unsubscribe()
      signal.removeEventListener('abort', onAbort)
      action()
    }
    const onAbort = (): void => settle(() => resolve('cancelled'))
    const unsubscribe = client.onEvent((event) => {
      if (event.type !== 'compaction_end' || event.reason !== 'manual') return
      settle(() => {
        const skipped = event.errorMessage ? compactionSkipReason(event.errorMessage) : null
        if (event.aborted) resolve('cancelled')
        else if (skipped) resolve(skipped)
        else if (event.errorMessage) reject(new Error(event.errorMessage))
        else resolve('compacted')
      })
    })
    // 发生进程中断时，结束事件可能不会到达；状态查询负责检测断连。
    const heartbeat = setInterval(() => {
      if (checking) return
      checking = true
      void client
        .getState()
        .catch((error: unknown) => settle(() => reject(error)))
        .finally(() => {
          checking = false
        })
    }, 5000)
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) {
      onAbort()
      return
    }
    void client.compact(instructions).then(
      () => settle(() => resolve('compacted')),
      (error: unknown) => {
        if (
          error instanceof Error &&
          error.message.startsWith('Timeout waiting for response to compact.')
        )
          return
        settle(() => {
          const skipped = compactionSkipReason(error)
          if (skipped) resolve(skipped)
          else reject(error)
        })
      }
    )
  })
}
