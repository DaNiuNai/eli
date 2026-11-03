import type { Plugin } from '@deepseek-ai/cordis'
import { createElement } from 'react'
import {
  BarChart3Icon,
  BookOpenIcon,
  BoxesIcon,
  BrainCircuitIcon,
  GlobeIcon,
  InfoIcon,
  PlugIcon,
  ServerIcon,
  Settings2Icon,
  SlidersHorizontalIcon,
  TerminalIcon
} from 'lucide-react'
import { UiRegistry } from './registry'
import type { SettingsPageProps } from './contracts'
import {
  GeneralPage,
  ProvidersPage,
  SkillsPage,
  McpPage,
  UsagePage,
  AboutPage
} from './settings-pages'
import App from '../App'
import { LanguageProvider } from '../components/LanguageProvider'
import { ThemeProvider } from '../components/ThemeProvider'
import { TooltipProvider } from '../components/ui/tooltip'
import { AppTitlebar } from '../components/AppTitlebar'
import { WorkspaceLayout } from '../components/WorkspaceLayout'
import { WelcomeDialog } from '../components/WelcomeDialog'
import { AgentSidebar } from '../components/AgentSidebar'
import { ChatMessage } from '../components/ChatMessage'
import { ChatComposer } from '../components/ChatComposer'
import { ToolApprovalPanel } from '../components/ToolApprovalPanel'
import { UserQuestionPanel } from '../components/UserQuestionPanel'
import { BackgroundTasksPanel } from '../components/BackgroundTasksPanel'
import { SubagentsPanel } from '../components/SubagentsPanel'
import { UsageDashboard } from '../components/UsageDashboard'
import { AppSettingsDialog } from '../components/AppSettingsDialog'
import { GeneralSettings } from '../components/GeneralSettings'
import { AgentSettingsPanel } from '../components/AgentSettingsPanel'
import { ProviderAuthDialog } from '../components/ProviderAuthDialog'

const modelPages = [
  { id: 'models', label: '模型与思考', icon: BrainCircuitIcon },
  { id: 'context', label: '上下文压缩', icon: SlidersHorizontalIcon },
  { id: 'network', label: '网络与重试', icon: GlobeIcon },
  { id: 'tools', label: '工具与 Shell', icon: TerminalIcon },
  { id: 'resources', label: '资源与加载', icon: BoxesIcon }
] as const
const modelComponents = modelPages.map(
  ({ id }) =>
    function ModelSettingsPage({ query }: SettingsPageProps): React.JSX.Element {
      return createElement(AgentSettingsPanel, {
        enabled: true,
        category: id,
        query,
        general: null
      })
    }
)

export const clientPlugins: Readonly<Record<string, Plugin>> = {
  'eli.ui-registry': {
    apply(ctx) {
      ctx.provide('ui', new UiRegistry())
    }
  },
  'eli.ui-providers': {
    inject: ['ui'],
    apply(ctx) {
      ctx.ui.register(ctx, 'providers', LanguageProvider, 'language', 0)
      ctx.ui.register(ctx, 'providers', ThemeProvider, 'theme', 10)
      ctx.ui.register(ctx, 'providers', TooltipProvider, 'tooltip', 20)
    }
  },
  'eli.ui-shell': {
    inject: ['ui'],
    apply(ctx) {
      ctx.ui.register(ctx, 'shell', App)
      ctx.ui.register(ctx, 'shell.titlebar', AppTitlebar)
      ctx.ui.register(ctx, 'shell.layout', WorkspaceLayout)
      ctx.ui.register(ctx, 'shell.welcome', WelcomeDialog)
    }
  },
  'eli.ui-conversation': {
    inject: ['ui'],
    apply(ctx) {
      ctx.ui.register(ctx, 'chat.message', ChatMessage)
      ctx.ui.register(ctx, 'chat.composer', ChatComposer)
    }
  },
  'eli.ui-sidebar': {
    inject: ['ui'],
    apply(ctx) {
      ctx.ui.register(ctx, 'shell.sidebar', AgentSidebar)
    }
  },
  'eli.ui-tasks': {
    inject: ['ui'],
    apply(ctx) {
      ctx.ui.register(ctx, 'tasks.background', BackgroundTasksPanel)
      ctx.ui.register(ctx, 'tasks.subagents', SubagentsPanel)
    }
  },
  'eli.ui-approvals': {
    inject: ['ui'],
    apply(ctx) {
      ctx.ui.register(ctx, 'chat.approvals', ToolApprovalPanel)
    }
  },
  'eli.ui-questions': {
    inject: ['ui'],
    apply(ctx) {
      ctx.ui.register(ctx, 'chat.question', UserQuestionPanel)
    }
  },
  'eli.ui-settings': {
    inject: ['ui'],
    apply(ctx) {
      ctx.ui.register(ctx, 'settings.dialog', AppSettingsDialog)
    }
  },
  'eli.ui-general-settings': {
    inject: ['ui'],
    apply(ctx) {
      ctx.ui.register(ctx, 'settings.general', GeneralSettings)
      ctx.ui.registerSettings(ctx, {
        id: 'general',
        label: '通用',
        description: '让 eli 更符合你的使用习惯。',
        icon: Settings2Icon,
        order: 0,
        keywords: [
          '通用',
          '外观',
          '主题',
          '终端',
          '默认工作目录',
          '目录',
          '文件夹',
          '自动批准',
          '审批',
          '审核模型',
          'general',
          'theme',
          'appearance',
          'terminal',
          'workspace',
          'directory',
          'folder',
          'shell',
          'powershell',
          'bash',
          'zsh'
        ],
        component: GeneralPage
      })
    }
  },
  'eli.ui-model-settings': {
    inject: ['ui'],
    apply(ctx) {
      ctx.ui.register(ctx, 'settings.auth', ProviderAuthDialog)
      ctx.ui.registerSettings(ctx, {
        id: 'providers',
        label: '模型供应商',
        description: '管理 eli Agent Runtime 的配置。',
        icon: PlugIcon,
        order: 20,
        component: ProvidersPage
      })
      modelPages.forEach((page, index) =>
        ctx.ui.registerSettings(ctx, {
          ...page,
          order: 30 + index,
          description: '管理 eli Agent Runtime 的配置。',
          search: index === 0,
          component: modelComponents[index]
        })
      )
    }
  },
  'eli.ui-skills': {
    inject: ['ui'],
    apply(ctx) {
      ctx.ui.registerSettings(ctx, {
        id: 'skills',
        label: 'Skill 管理',
        description: '查看和管理用户级 Skill。',
        icon: BookOpenIcon,
        order: 60,
        keywords: ['Skill 管理', '用户级 Skill', '技能', 'skills'],
        component: SkillsPage
      })
    }
  },
  'eli.ui-mcp': {
    inject: ['ui'],
    apply(ctx) {
      ctx.ui.registerSettings(ctx, {
        id: 'mcp',
        label: 'MCP 管理',
        description: '配置 MCP 服务并查看可用工具。',
        icon: ServerIcon,
        order: 70,
        keywords: ['MCP 管理', 'MCP 服务', 'stdio', 'HTTP'],
        component: McpPage
      })
    }
  },
  'eli.ui-usage': {
    inject: ['ui'],
    apply(ctx) {
      ctx.ui.register(ctx, 'usage.dashboard', UsageDashboard)
      ctx.ui.registerSettings(ctx, {
        id: 'usage',
        label: '用量看板',
        description: '查看本机模型用量、费用与请求记录。',
        icon: BarChart3Icon,
        order: 10,
        keywords: [
          '用量看板',
          '用量统计',
          '费用',
          '请求日志',
          '缓存',
          '热力图',
          'usage',
          'dashboard',
          'cost',
          'token',
          'cache'
        ],
        component: UsagePage
      })
    }
  },
  'eli.ui-about': {
    inject: ['ui'],
    apply(ctx) {
      ctx.ui.registerSettings(ctx, {
        id: 'about',
        label: '关于',
        description: '查看 eli 版本与软件更新。',
        icon: InfoIcon,
        order: 90,
        keywords: [
          '关于',
          '软件更新',
          '检查更新',
          '版本',
          '下载',
          'about',
          'update',
          'version',
          'download',
          'github'
        ],
        component: AboutPage
      })
    }
  }
}
