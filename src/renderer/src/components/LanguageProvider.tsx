import { useLayoutEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { LanguageContext } from '@renderer/hooks/use-language'
import { translate, type TranslationValues } from '@renderer/lib/translations'
import {
  getAppPreferences,
  subscribeAppPreferences,
  updateAppPreferences
} from '@renderer/lib/app-preferences'
import type { UiLanguage } from '../../../shared/app-preferences'

export function LanguageProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { language } = useSyncExternalStore(subscribeAppPreferences, getAppPreferences)

  useLayoutEffect(() => {
    document.documentElement.lang = language
  }, [language])

  const value = useMemo(
    () => ({
      language,
      locale: language === 'en' ? 'en-US' : 'zh-CN',
      t: (source: string, values?: TranslationValues) => translate(source, language, values),
      setLanguage: (next: UiLanguage): void => {
        updateAppPreferences({ language: next })
      }
    }),
    [language]
  )

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}
