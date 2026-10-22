import type { PiApi } from '../shared/pi'
import type { WindowAppearanceApi } from '../shared/window-appearance'
import type { AppPreferencesApi } from '../shared/app-preferences'
import type { PiAuthApi } from '../shared/pi-auth'
import type { TerminalApi } from '../shared/terminal'

declare global {
  interface Window {
    api: PiApi // 包含工具审批、用户答复、原生图片选择与拖入文件路径；图片复制由主进程处理。
    appPreferences: AppPreferencesApi // 包括归档工作目录的持久化设置。
    piAuth: PiAuthApi // pi 登录交互；凭据由主进程中的 SDK 保存。
    terminal: TerminalApi // 检测和验证 eli 使用的 Shell，不写入 pi 配置。
    windowAppearance?: WindowAppearanceApi
  }
}
