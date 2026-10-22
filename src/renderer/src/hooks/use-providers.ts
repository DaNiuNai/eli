import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProviderChange, ProvidersSnapshot } from '../../../shared/providers'

export function useProviders(refreshKey: number): {
  data: ProvidersSnapshot | null
  loading: boolean
  pending: boolean
  error: string | null
  change: (change: ProviderChange) => Promise<boolean>
} {
  const [data, setData] = useState<ProvidersSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const [version, setVersion] = useState(0)
  const active = useRef(true)
  const revision = useRef(0)
  useEffect(() => window.providers.onChanged(() => setVersion((current) => current + 1)), [])
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  useEffect(() => {
    const current = ++revision.current
    let mounted = true
    void window.providers
      .get()
      .then(
        (next) => {
          if (mounted && current === revision.current) {
            setData(next)
            setError(null)
          }
        },
        (cause: unknown) => {
          if (mounted && current === revision.current) setError(String(cause))
        }
      )
      .finally(() => {
        if (mounted) setLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [refreshKey, version])
  const change = useCallback(async (change: ProviderChange): Promise<boolean> => {
    revision.current++
    setPending(true)
    setError(null)
    try {
      const next = await window.providers.change(change)
      if (active.current) setData(next)
      return true
    } catch (cause) {
      if (active.current) setError(cause instanceof Error ? cause.message : String(cause))
      return false
    } finally {
      if (active.current) setPending(false)
    }
  }, [])
  return {
    data,
    error,
    loading,
    pending,
    change
  }
}
