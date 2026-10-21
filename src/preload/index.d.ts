import type { PiApi } from '../shared/pi'
import type { WindowAppearanceApi } from '../shared/window-appearance'
import type { AppPreferencesApi } from '../shared/app-preferences'

declare global {
  interface Window {
    api: PiApi // 会话操作携带会话标识，支持后台任务与并发会话。
    appPreferences: AppPreferencesApi
    windowAppearance?: WindowAppearanceApi
  }
}
