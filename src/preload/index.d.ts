import type { AgentApi } from '../shared/agent'
import type { WindowAppearanceApi } from '../shared/window-appearance'
import type { AppPreferencesApi } from '../shared/app-preferences'
import type { AgentAuthApi } from '../shared/agent-auth'
import type { TerminalApi } from '../shared/terminal'
import type { ProvidersApi } from '../shared/providers'
import type { AppUpdatesApi } from '../shared/app-updates'

declare global {
  interface Window {
    providers: ProvidersApi
    appUpdates: AppUpdatesApi
    api: AgentApi // 包含工具审批、用户答复、原生图片选择与拖入文件路径；图片复制由主进程处理。
    appPreferences: AppPreferencesApi // 包括归档工作目录的持久化设置。
    agentAuth: AgentAuthApi // 登录交互；凭据由独立 Runtime 中的 SDK 保存。
    terminal: TerminalApi // 检测和验证 eli 使用的 Shell。
    windowAppearance?: WindowAppearanceApi
  }
}
