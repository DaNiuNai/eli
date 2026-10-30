import { useCallback, useEffect, useRef, useState } from 'react'
import { rememberSidebarSessions } from '@renderer/lib/sidebar-order'
import { shareSnapshot } from '@renderer/lib/share-snapshot'
import type { AgentLibrary } from '../../../shared/agent-library'

interface LibraryResult {
  library: AgentLibrary | null
  error: string | null
}

export function useAgentLibrary(version: number | undefined): {
  library: AgentLibrary | null
  loading: boolean
  error: string | null
  reload: () => void
} {
  const [request, setRequest] = useState(0)
  const [result, setResult] = useState<LibraryResult | null>(null)
  const hasResult = useRef(false)
  const mounted = useRef(false)
  const currentRequest = useRef(0)
  const reload = useCallback(() => setRequest((current) => current + 1), [])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (!window.api || version === undefined) return
    // 合并工具连续完成造成的失效通知，后台更新保留现有列表与统计。
    const timer = setTimeout(
      () => {
        const id = ++currentRequest.current
        void window.api
          .getLibrary()
          .then((library) => {
            if (mounted.current && id === currentRequest.current) {
              hasResult.current = true
              rememberSidebarSessions(library.sessions)
              setResult((previous) => ({
                library: previous?.library ? shareSnapshot(previous.library, library) : library,
                error: null
              }))
            }
          })
          .catch((cause: unknown) => {
            if (mounted.current && id === currentRequest.current) {
              hasResult.current = true
              setResult((previous) => ({
                library: previous?.library ?? null,
                error: cause instanceof Error ? cause.message : String(cause)
              }))
            }
          })
      },
      hasResult.current ? 250 : 0
    )
    return () => {
      clearTimeout(timer)
    }
  }, [version, request])

  return {
    library: result?.library ?? null,
    loading: !!window.api && !result,
    error: result?.error ?? null,
    reload
  }
}
