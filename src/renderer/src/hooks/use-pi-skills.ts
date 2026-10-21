import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PiSkillCommand } from '../../../shared/pi'

export function usePiSkills(
  sessionKey: string | undefined,
  open: boolean
): {
  skills: PiSkillCommand[]
  loading: boolean
  error: string | null
  reload: () => void
} {
  const [request, setRequest] = useState(0)
  const requestKey = useMemo(() => ({ sessionKey, open, request }), [sessionKey, open, request])
  const [result, setResult] = useState<{
    skills: PiSkillCommand[]
    error: string | null
    key: typeof requestKey
  } | null>(null)
  const reload = useCallback(() => setRequest((current) => current + 1), [])

  useEffect(() => {
    const { sessionKey, open } = requestKey
    if (!open || !sessionKey || !window.api) return
    let active = true
    void window.api.getSkills(sessionKey).then(
      (skills) => {
        if (active) setResult({ skills, error: null, key: requestKey })
      },
      (cause: unknown) => {
        if (active)
          setResult({
            skills: [],
            error: cause instanceof Error ? cause.message : String(cause),
            key: requestKey
          })
      }
    )
    return () => {
      active = false
    }
  }, [requestKey])

  const current = result?.key === requestKey ? result : null
  return {
    skills: current?.skills ?? [],
    loading: open && !current,
    error: current?.error ?? null,
    reload
  }
}
