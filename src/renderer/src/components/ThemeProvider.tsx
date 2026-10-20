import { useLayoutEffect, useState } from 'react'
import { isTheme, ThemeContext, type Theme } from '@renderer/hooks/use-theme'

const storageKey = 'eli-ui-theme'

export function ThemeProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const savedTheme = localStorage.getItem(storageKey)
      if (isTheme(savedTheme)) return savedTheme
    } catch {
      // 本地存储不可用时仍可跟随系统并切换主题。
    }
    return 'system'
  })

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
    setTheme(nextTheme)
    try {
      localStorage.setItem(storageKey, nextTheme)
    } catch {
      // 保存失败不影响本次使用。
    }
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme: changeTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}
