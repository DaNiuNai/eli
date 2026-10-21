import { useCallback, useEffect, useState } from 'react'
import { rememberSidebarSessions } from '@renderer/lib/sidebar-order'
import type { PiLibrary } from '../../../shared/pi-library'

interface LibraryResult {
  library: PiLibrary | null
  error: string | null
  version: number | undefined
  request: number
}

export function usePiLibrary(version: number | undefined): {
  library: PiLibrary | null
  loading: boolean
  error: string | null
  reload: () => void
} {
  const [request, setRequest] = useState(0)
  const [result, setResult] = useState<LibraryResult | null>(null)
  const reload = useCallback(() => setRequest((current) => current + 1), [])

  useEffect(() => {
    if (!window.api) return
    let active = true
    void window.api
      .getLibrary()
      .then((library) => {
        if (active) {
          rememberSidebarSessions(library.sessions)
          setResult({ library, error: null, version, request })
        }
      })
      .catch((cause: unknown) => {
        if (active)
          setResult((previous) => ({
            library: previous?.library ?? null,
            error: cause instanceof Error ? cause.message : String(cause),
            version,
            request
          }))
      })
    return () => {
      active = false
    }
  }, [version, request])

  return {
    library: result?.library ?? null,
    loading: !!window.api && (!result || result.version !== version || result.request !== request),
    error: result?.error ?? null,
    reload
  }
}
