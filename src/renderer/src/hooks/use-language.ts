import { createContext, useContext } from 'react'
import type { UiLanguage } from '../../../shared/app-preferences'
import type { Translate } from '@renderer/lib/translations'

export { isUiLanguage } from '../../../shared/app-preferences'

export const LanguageContext = createContext<{
  language: UiLanguage
  locale: string
  setLanguage: (language: UiLanguage) => void
  t: Translate
} | null>(null)

export function useLanguage(): NonNullable<React.ContextType<typeof LanguageContext>> {
  const context = useContext(LanguageContext)
  if (!context) throw new Error('useLanguage 必须在 LanguageProvider 内使用')
  return context
}
