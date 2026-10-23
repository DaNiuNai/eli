import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentAuthSnapshot } from '../../../shared/agent-auth'

export function useAgentAuth(): {
  snapshot: AgentAuthSnapshot | null
  open: boolean
  welcomeOpen: boolean
  loading: boolean
  error: string | null
  onOpenChange: (open: boolean) => void
  onWelcomeOpenChange: (open: boolean) => void
  perform: (action: () => Promise<unknown>) => Promise<boolean>
} {
  const [snapshot, setSnapshot] = useState<AgentAuthSnapshot | null>(null)
  const [open, setOpen] = useState(false)
  const [welcomeOpen, setWelcomeOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef<AgentAuthSnapshot | null>(null)

  const receive = useCallback((next: AgentAuthSnapshot) => {
    const previous = latest.current
    if (previous && next.revision < previous.revision) return
    latest.current = next
    if (!previous && next.firstLaunch) {
      setWelcomeOpen(true)
    }
    setSnapshot(next)
  }, [])

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

  const refresh = useCallback(async () => {
    setLoading(true)
    await perform(async () => receive(await window.agentAuth.get()))
    setLoading(false)
  }, [perform, receive])

  const onOpenChange = useCallback(
    (value: boolean) => {
      setOpen(value)
      if (value) void refresh()
      else void perform(() => window.agentAuth.cancel())
    },
    [perform, refresh]
  )

  useEffect(() => {
    if (!window.agentAuth) return
    let active = true
    const unsubscribe = window.agentAuth.onSnapshot((next) => active && receive(next))
    void window.agentAuth
      .get()
      .then((next) => active && receive(next))
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
      unsubscribe()
    }
  }, [receive])

  return {
    snapshot,
    open,
    welcomeOpen,
    loading,
    error,
    onOpenChange,
    onWelcomeOpenChange: setWelcomeOpen,
    perform
  }
}
