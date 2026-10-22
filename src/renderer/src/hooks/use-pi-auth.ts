import { useCallback, useEffect, useRef, useState } from 'react'
import type { PiAuthSnapshot } from '../../../shared/pi-auth'

export function usePiAuth(): {
  snapshot: PiAuthSnapshot | null
  open: boolean
  loading: boolean
  error: string | null
  terminalSetupOpen: boolean
  completeTerminalSetup: () => void
  onOpenChange: (open: boolean) => void
  perform: (action: () => Promise<unknown>) => Promise<boolean>
} {
  const [snapshot, setSnapshot] = useState<PiAuthSnapshot | null>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [terminalSetupOpen, setTerminalSetupOpen] = useState(false)
  const firstLogin = useRef(false)
  const latest = useRef<PiAuthSnapshot | null>(null)

  const receive = useCallback((next: PiAuthSnapshot) => {
    const previous = latest.current
    if (previous && next.revision < previous.revision) return
    latest.current = next
    if (!previous && next.firstLaunch) {
      firstLogin.current = true
      setOpen(true)
    }
    if (next.status === 'success' && previous?.status !== 'success') {
      setOpen(false)
      if (firstLogin.current) {
        firstLogin.current = false
        setTerminalSetupOpen(true)
      }
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
    await perform(async () => receive(await window.piAuth.get()))
    setLoading(false)
  }, [perform, receive])

  const onOpenChange = useCallback(
    (value: boolean) => {
      setOpen(value)
      if (value) void refresh()
      else {
        if (firstLogin.current) {
          firstLogin.current = false
          setTerminalSetupOpen(true)
        }
        void perform(() => window.piAuth.cancel())
      }
    },
    [perform, refresh]
  )

  useEffect(() => {
    if (!window.piAuth) return
    let active = true
    const unsubscribe = window.piAuth.onSnapshot((next) => active && receive(next))
    void window.piAuth
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
    loading,
    error,
    onOpenChange,
    perform,
    terminalSetupOpen,
    completeTerminalSetup: () => setTerminalSetupOpen(false)
  }
}
