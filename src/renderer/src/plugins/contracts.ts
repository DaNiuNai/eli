import type { ComponentProps, ComponentType, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { useAgentAuth } from '../hooks/use-agent-auth'
import type { UsageSettingsPanelProps } from '../components/UsageSettingsPanel'

/** 插件通过声明合并扩展插槽；各插槽的调用参数由拥有该界面的模块定义。 */
export interface UiSlots {
  shell: { children?: never }
  providers: { children: ReactNode }
  'shell.titlebar': ComponentProps<typeof import('../components/AppTitlebar').AppTitlebar>
  'shell.layout': ComponentProps<typeof import('../components/WorkspaceLayout').WorkspaceLayout>
  'shell.sidebar': ComponentProps<typeof import('../components/AgentSidebar').AgentSidebar>
  'shell.welcome': ComponentProps<typeof import('../components/WelcomeDialog').WelcomeDialog>
  'settings.dialog': ComponentProps<
    typeof import('../components/AppSettingsDialog').AppSettingsDialog
  >
  'settings.general': { children?: never }
  'settings.auth': ComponentProps<
    typeof import('../components/ProviderAuthDialog').ProviderAuthDialog
  >
  'chat.message': ComponentProps<typeof import('../components/ChatMessage').ChatMessage>
  'chat.composer': ComponentProps<typeof import('../components/ChatComposer').ChatComposer>
  'chat.approvals': ComponentProps<
    typeof import('../components/ToolApprovalPanel').ToolApprovalPanel
  >
  'chat.question': ComponentProps<
    typeof import('../components/UserQuestionPanel').UserQuestionPanel
  >
  'tasks.background': ComponentProps<
    typeof import('../components/BackgroundTasksPanel').BackgroundTasksPanel
  >
  'tasks.subagents': ComponentProps<typeof import('../components/SubagentsPanel').SubagentsPanel>
  'usage.dashboard': ComponentProps<typeof import('../components/UsageDashboard').UsageDashboard>
}

export interface SettingsPageProps {
  query: string
  login: ReturnType<typeof useAgentAuth>
  usage: UsageSettingsPanelProps
  close(): void
}

export interface SettingsPage {
  id: string
  label: string
  description: string
  icon: LucideIcon
  order: number
  keywords?: string[]
  search?: boolean
  component: ComponentType<SettingsPageProps>
}

export interface SlotEntry<K extends keyof UiSlots> {
  id: string
  order: number
  component: ComponentType<UiSlots[K]>
}
