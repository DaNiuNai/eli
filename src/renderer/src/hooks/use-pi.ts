import { useCallback, useEffect, useState } from 'react'
import type { PiSnapshot } from '../../../shared/pi'
import { rememberSidebarSessions } from '@renderer/lib/sidebar-order'

export function usePi(): {
  snapshot: PiSnapshot | null
  error: string | null
  perform: (action: () => Promise<unknown>, sessionKey?: string) => Promise<boolean>
} {
  const [snapshot, setSnapshot] = useState<PiSnapshot | null>(null)
  const [error, setError] = useState<{ text: string; sessionKey?: string } | null>(
    window.api ? null : { text: '请通过 pnpm dev 启动桌面应用，浏览器预览无法连接本机服务。' }
  )
  const perform = useCallback(
    async (action: () => Promise<unknown>, sessionKey?: string): Promise<boolean> => {
      setError((previous) => (previous?.sessionKey === sessionKey ? null : previous))
      try {
        await action()
        return true
      } catch (cause) {
        setError({ text: cause instanceof Error ? cause.message : String(cause), sessionKey })
        return false
      }
    },
    []
  )

  useEffect(() => {
    if (!window.api) return
    let active = true
    let revision = -1
    const receive = (next: PiSnapshot): void => {
      if (!active || next.revision < revision) return
      revision = next.revision
      rememberSidebarSessions([...next.liveSessions].sort((a, b) => b.created - a.created))
      setSnapshot((previous) => (!previous || next.revision >= previous.revision ? next : previous))
    }
    // 先订阅再初始化，revision 防止较慢的 connect 响应覆盖新的流式消息。
    const unsubscribe = window.api.onSnapshot(receive)
    void window.api
      .connect()
      .then(receive)
      .catch((cause: unknown) => {
        if (active) setError({ text: cause instanceof Error ? cause.message : String(cause) })
      })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return {
    snapshot,
    error:
      !error?.sessionKey || error.sessionKey === snapshot?.sessionKey
        ? (error?.text ?? null)
        : null,
    perform
  }
}
