import { useCallback, useEffect, useState } from 'react'
import type { AgentSnapshot } from '../../../shared/agent'
import { rememberSidebarSessions } from '@renderer/lib/sidebar-order'
import { shareSnapshot } from '@renderer/lib/share-snapshot'

export function useAgent(): {
  snapshot: AgentSnapshot | null
  error: string | null
  perform: (action: () => Promise<unknown>, sessionKey?: string) => Promise<boolean>
} {
  const [snapshot, setSnapshot] = useState<AgentSnapshot | null>(null)
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
        const text = cause instanceof Error ? cause.message : String(cause)
        // 主进程会发布目录失效状态，统一由侧栏和输入区提示。
        if (!text.includes('工作目录不存在或无法访问')) setError({ text, sessionKey })
        return false
      }
    },
    []
  )

  useEffect(() => {
    if (!window.api) return
    let active = true
    let latest: AgentSnapshot | null = null
    const receive = (next: AgentSnapshot): void => {
      if (!active || (latest && next.revision <= latest.revision)) return
      const shared = latest ? shareSnapshot(latest, next) : next
      if (latest?.liveSessions !== shared.liveSessions)
        rememberSidebarSessions([...shared.liveSessions].sort((a, b) => b.created - a.created))
      latest = shared
      setSnapshot(shared)
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
