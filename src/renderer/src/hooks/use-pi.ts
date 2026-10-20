import { useCallback, useEffect, useState } from 'react'
import type { PiSnapshot } from '../../../shared/pi'

export function usePi(): {
  snapshot: PiSnapshot | null
  error: string | null
  perform: (action: () => Promise<unknown>) => Promise<boolean>
} {
  const [snapshot, setSnapshot] = useState<PiSnapshot | null>(null)
  const [error, setError] = useState<string | null>(
    window.api ? null : '请通过 pnpm dev 启动桌面应用，浏览器预览无法连接本机服务。'
  )
  const perform = useCallback(async (action: () => Promise<unknown>): Promise<boolean> => {
    setError(null)
    try {
      await action()
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return false
    }
  }, [])

  useEffect(() => {
    if (!window.api) return
    let active = true
    const receive = (next: PiSnapshot): void => {
      if (!active) return
      setSnapshot((previous) => (!previous || next.revision >= previous.revision ? next : previous))
    }
    // 先订阅再初始化，revision 防止较慢的 connect 响应覆盖新的流式消息。
    const unsubscribe = window.api.onSnapshot(receive)
    void window.api
      .connect()
      .then(receive)
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return { snapshot, error, perform }
}
