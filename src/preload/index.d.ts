import type { PiApi } from '../shared/pi'
import type { WindowAppearanceApi } from '../shared/window-appearance'
import type { AppPreferencesApi } from '../shared/app-preferences'

declare global {
  interface Window {
    api: PiApi // 包括按会话压缩上下文、查询技能、工作目录可用状态，以及选择目录后返回的路径。
    appPreferences: AppPreferencesApi // 包括归档工作目录的持久化设置。
    windowAppearance?: WindowAppearanceApi
  }
}
