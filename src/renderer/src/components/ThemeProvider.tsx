import { useLayoutEffect, useSyncExternalStore } from 'react'
import { ThemeContext, type Theme } from '@renderer/hooks/use-theme'
import {
  getAppPreferences,
  subscribeAppPreferences,
  updateAppPreferences
} from '@renderer/lib/app-preferences'

export function ThemeProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { theme } = useSyncExternalStore(subscribeAppPreferences, getAppPreferences)

  useLayoutEffect(() => {
    const root = document.documentElement
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const applyTheme = (): void => {
      const resolvedTheme = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme
      root.classList.remove('light', 'dark')
      root.classList.add(resolvedTheme)
      root.style.colorScheme = resolvedTheme
      void window.windowAppearance
        ?.setDarkMode(resolvedTheme === 'dark')
        .catch((error: unknown) => {
          console.error('同步窗口主题失败', error)
        })
    }

    applyTheme()

    if (theme !== 'system') return

    media.addEventListener('change', applyTheme)
    return () => media.removeEventListener('change', applyTheme)
  }, [theme])

  function changeTheme(nextTheme: Theme): void {
    updateAppPreferences({ theme: nextTheme })
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme: changeTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}
