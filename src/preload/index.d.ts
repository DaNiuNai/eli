import type { PiApi } from '../shared/pi'
import type { WindowAppearanceApi } from '../shared/window-appearance'
import type { AppPreferencesApi } from '../shared/app-preferences'

declare global {
  interface Window {
    api: PiApi // 包括读取与保存 PI 全局设置的类型。
    appPreferences: AppPreferencesApi
    windowAppearance?: WindowAppearanceApi
  }
}
