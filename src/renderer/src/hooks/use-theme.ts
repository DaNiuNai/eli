import { createContext, useContext } from 'react'
import type { Theme } from '../../../shared/app-preferences'

export { isTheme, type Theme } from '../../../shared/app-preferences'

export const ThemeContext = createContext<{
  theme: Theme
  setTheme: (theme: Theme) => void
} | null>(null)

export function useTheme(): NonNullable<React.ContextType<typeof ThemeContext>> {
  const context = useContext(ThemeContext)

  if (!context) throw new Error('useTheme 必须在 ThemeProvider 内使用')

  return context
}
