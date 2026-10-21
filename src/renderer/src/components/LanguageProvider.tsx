import { useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { isUiLanguage, LanguageContext } from '@renderer/hooks/use-language'
import { translate, type TranslationValues } from '@renderer/lib/translations'
import type { UiLanguage } from '../../../shared/app-preferences'

const storageKey = 'eli-ui-language'

export function LanguageProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [language, setLanguage] = useState<UiLanguage>(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (isUiLanguage(saved)) return saved
    } catch {
      // 无法读取时使用默认语言。
    }
    return 'zh-CN'
  })

  useLayoutEffect(() => {
    document.documentElement.lang = language
  }, [language])

  const value = useMemo(
    () => ({
      language,
      locale: language === 'en' ? 'en-US' : 'zh-CN',
      t: (source: string, values?: TranslationValues) => translate(source, language, values),
      setLanguage: (next: UiLanguage): void => {
        setLanguage(next)
        try {
          localStorage.setItem(storageKey, next)
        } catch {
          // 保存失败不影响当前界面的语言。
        }
      }
    }),
    [language]
  )

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}
