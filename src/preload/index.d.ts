import type { PiApi } from '../shared/pi'
import type { WindowAppearanceApi } from '../shared/window-appearance'
import type { AppPreferencesApi } from '../shared/app-preferences'

declare global {
  interface Window {
    api: PiApi // 包含消息编辑、复制分叉和本机图片读取的 IPC 接口。
    appPreferences: AppPreferencesApi
    windowAppearance?: WindowAppearanceApi
  }
}
