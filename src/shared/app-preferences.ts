export type UiLanguage = 'zh-CN' | 'en'
export type Theme = 'light' | 'dark' | 'system'

export const sidebarSizing = { defaultWidth: 272, minWidth: 200, maxWidth: 480 } as const

export interface SidebarOrder {
  workspaces: string[]
  sessions: Record<string, string[]>
}

export interface AppPreferences {
  theme: Theme
  language: UiLanguage
  sidebarOpen: boolean
  sidebarWidth: number
  sidebarOrder: SidebarOrder
}

export interface AppPreferencesApi {
  get(): Promise<AppPreferences>
  set(preferences: AppPreferences): Promise<void>
}

export const appPreferencesChannels = {
  get: 'app-preferences:get',
  set: 'app-preferences:set'
} as const

export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system'
}

export function isUiLanguage(value: unknown): value is UiLanguage {
  return value === 'zh-CN' || value === 'en'
}

export function defaultAppPreferences(): AppPreferences {
  return {
    theme: 'system',
    language: 'zh-CN',
    sidebarOpen: true,
    sidebarWidth: sidebarSizing.defaultWidth,
    sidebarOrder: { workspaces: [], sessions: {} }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error('侧栏排序必须是字符串数组')
  }
  return [...new Set(value)]
}

// 允许省略配置项以使用默认值，但不静默覆盖格式错误的设置。
export function parseAppPreferences(value: unknown): AppPreferences {
  if (!isRecord(value)) throw new Error('配置必须是 JSON 对象')
  const defaults = defaultAppPreferences()
  const theme = value.theme === undefined ? defaults.theme : value.theme
  const language = value.language === undefined ? defaults.language : value.language
  const sidebarOpen = value.sidebarOpen === undefined ? defaults.sidebarOpen : value.sidebarOpen
  const sidebarWidth = value.sidebarWidth === undefined ? defaults.sidebarWidth : value.sidebarWidth
  if (!isTheme(theme)) throw new Error('无效的主题设置')
  if (!isUiLanguage(language)) throw new Error('无效的语言设置')
  if (typeof sidebarOpen !== 'boolean') throw new Error('无效的侧栏展开设置')
  if (
    typeof sidebarWidth !== 'number' ||
    !Number.isFinite(sidebarWidth) ||
    sidebarWidth < sidebarSizing.minWidth ||
    sidebarWidth > sidebarSizing.maxWidth
  ) {
    throw new Error('无效的侧栏宽度设置')
  }

  let sidebarOrder = defaults.sidebarOrder
  if (value.sidebarOrder !== undefined) {
    if (!isRecord(value.sidebarOrder)) throw new Error('无效的侧栏排序设置')
    const sessions = value.sidebarOrder.sessions === undefined ? {} : value.sidebarOrder.sessions
    if (!isRecord(sessions)) throw new Error('无效的会话排序设置')
    sidebarOrder = {
      workspaces: stringList(
        value.sidebarOrder.workspaces === undefined ? [] : value.sidebarOrder.workspaces
      ),
      sessions: Object.fromEntries(
        Object.entries(sessions).map(([cwd, paths]) => [cwd, stringList(paths)])
      )
    }
  }

  return { theme, language, sidebarOpen, sidebarWidth, sidebarOrder }
}
