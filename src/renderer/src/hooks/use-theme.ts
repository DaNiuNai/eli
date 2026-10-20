import { createContext, useContext } from 'react'

export type Theme = 'light' | 'dark' | 'system'

export const ThemeContext = createContext<{
  theme: Theme
  setTheme: (theme: Theme) => void
} | null>(null)

export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system'
}

export function useTheme(): NonNullable<React.ContextType<typeof ThemeContext>> {
  const context = useContext(ThemeContext)

  if (!context) throw new Error('useTheme 必须在 ThemeProvider 内使用')

  return context
}
