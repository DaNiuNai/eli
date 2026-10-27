import type { AgentApi } from '../shared/agent'
import type { WindowAppearanceApi } from '../shared/window-appearance'
import type { AppPreferencesApi } from '../shared/app-preferences'
import type { AgentAuthApi } from '../shared/agent-auth'
import type { TerminalApi } from '../shared/terminal'
import type { ProvidersApi } from '../shared/providers'
import type { AppUpdatesApi } from '../shared/app-updates'
import type { McpAuthApi } from '../shared/mcp'

declare global {
  interface Window {
    providers: ProvidersApi
    mcpAuth: McpAuthApi
    appUpdates: AppUpdatesApi
    api: AgentApi // 包含 MCP / Skill 管理、工具审批、用户答复与附件操作。
    appPreferences: AppPreferencesApi // 包括默认工作目录、归档目录与自动批准模型的持久化设置。
    agentAuth: AgentAuthApi // 登录交互；凭据由独立 Runtime 中的 SDK 保存。
    terminal: TerminalApi // 检测和验证 eli 使用的 Shell。
    windowAppearance?: WindowAppearanceApi
  }
}
