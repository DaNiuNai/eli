import type { PiApi } from '../shared/pi'
import type { WindowAppearanceApi } from '../shared/window-appearance'
import type { AppPreferencesApi } from '../shared/app-preferences'
import type { PiAuthApi } from '../shared/pi-auth'

declare global {
  interface Window {
    api: PiApi // 会话快照包含回复阶段、请求序号和流式工具参数；接收确认以本机 pi 为准。
    appPreferences: AppPreferencesApi // 包括归档工作目录的持久化设置。
    piAuth: PiAuthApi // pi 登录交互；凭据由主进程中的 SDK 保存。
    windowAppearance?: WindowAppearanceApi
  }
}
