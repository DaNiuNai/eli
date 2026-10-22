export type AgentSettingsCategory = 'models' | 'context' | 'network' | 'tools' | 'resources'

export interface AgentSettingDefinition {
  key: string
  category: AgentSettingsCategory
  section: string
  label: string
  description: string
  kind: 'boolean' | 'string' | 'number' | 'select' | 'lines' | 'json'
  defaultValue?: unknown
  options?: (string | number)[]
  min?: number
  max?: number
  placeholder?: string
}

// eli 的可配置引擎选项。存储及资源发现规则由应用固定，不暴露 CLI 专属配置。
export const agentSettingDefinitions: AgentSettingDefinition[] = [
  {
    key: 'defaultProvider',
    category: 'models',
    section: '默认模型',
    label: '默认提供商',
    description: '新对话使用的模型提供商。留空时自动选择。',
    kind: 'string'
  },
  {
    key: 'defaultModel',
    category: 'models',
    section: '默认模型',
    label: '默认模型',
    description: '新对话使用的模型 ID，不会改变已有对话的模型。',
    kind: 'string'
  },
  {
    key: 'enabledModels',
    category: 'models',
    section: '默认模型',
    label: '可用模型范围',
    description: '每行一个模型匹配模式，例如 anthropic/*。留空列表表示所有可用模型。',
    kind: 'lines',
    placeholder: 'anthropic/*\nopenai/*'
  },
  {
    key: 'defaultThinkingLevel',
    category: 'models',
    section: '思考',
    label: '默认思考强度',
    description: '新对话的思考强度，会根据模型能力自动调整。',
    kind: 'select',
    defaultValue: 'medium',
    options: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
  },
  {
    key: 'modelThinkingLevels',
    category: 'models',
    section: '思考',
    label: '各模型思考强度',
    description: '以 provider/modelId 为键、思考强度为值的 JSON 对象。',
    kind: 'json',
    defaultValue: {},
    placeholder: '{"anthropic/claude-sonnet-4-6": "high"}'
  },
  ...(['minimal', 'low', 'medium', 'high'] as const).map((level): AgentSettingDefinition => ({
    key: `thinkingBudgets.${level}`,
    category: 'models',
    section: '思考预算',
    label: `${level} 思考预算`,
    description: '该强度的思考 token 上限。留空时使用模型内置预算。',
    kind: 'number',
    min: 0
  })),
  {
    key: 'hideThinkingBlock',
    category: 'models',
    section: '思考',
    label: '隐藏思考内容',
    description: '在对话记录中隐藏思考过程，工具调用仍然显示。',
    kind: 'boolean',
    defaultValue: false
  },
  {
    key: 'cacheWarming',
    category: 'models',
    section: '提示词缓存',
    label: '缓存预热',
    description: '在响应期间或空闲时保持支持的模型缓存有效。预热请求会计入用量。',
    kind: 'select',
    defaultValue: 'streaming',
    options: ['off', 'streaming', 'idle']
  },
  {
    key: 'compaction.enabled',
    category: 'context',
    section: '自动压缩',
    label: '自动压缩上下文',
    description: '接近上下文窗口上限时，自动总结较早的消息。',
    kind: 'boolean',
    defaultValue: true
  },
  {
    key: 'compaction.reserveTokens',
    category: 'context',
    section: '自动压缩',
    label: '响应预留 token',
    description: '压缩时为模型后续响应预留的 token 数量。',
    kind: 'number',
    defaultValue: 16384,
    min: 0
  },
  {
    key: 'compaction.keepRecentTokens',
    category: 'context',
    section: '自动压缩',
    label: '保留最近 token',
    description: '最近的这些 token 保留原文，不参与总结。',
    kind: 'number',
    defaultValue: 20000,
    min: 0
  },
  {
    key: 'compaction.modelOverrides',
    category: 'context',
    section: '自动压缩',
    label: '各模型压缩配置',
    description: '以 provider/modelId 为键，分别设置 reserveTokens 和 keepRecentTokens。',
    kind: 'json',
    defaultValue: {},
    placeholder: '{"provider/model": {"reserveTokens": 16384}}'
  },
  {
    key: 'transport',
    category: 'network',
    section: '连接',
    label: '传输方式',
    description: '为支持的模型提供商选择流式传输协议。',
    kind: 'select',
    defaultValue: 'auto',
    options: ['auto', 'sse', 'websocket', 'websocket-cached']
  },
  {
    key: 'httpProxy',
    category: 'network',
    section: '连接',
    label: 'HTTP 代理',
    description: 'SDK 管理的 HTTP 客户端使用的代理地址。留空时使用 SDK 的默认行为。',
    kind: 'string',
    placeholder: 'http://127.0.0.1:7890'
  },
  {
    key: 'httpIdleTimeoutMs',
    category: 'network',
    section: '连接',
    label: 'HTTP 空闲超时',
    description: '等待响应头或响应体数据的超时，单位毫秒；0 表示禁用。',
    kind: 'number',
    defaultValue: 300000,
    min: 0
  },
  {
    key: 'websocketConnectTimeoutMs',
    category: 'network',
    section: '连接',
    label: 'WebSocket 连接超时',
    description: '连接和握手的超时，单位毫秒；0 表示禁用。',
    kind: 'number',
    defaultValue: 15000,
    min: 0
  },
  {
    key: 'retry.enabled',
    category: 'network',
    section: '自动重试',
    label: '自动重试',
    description: '遇到临时服务错误时，允许 SDK 自动重试。',
    kind: 'boolean',
    defaultValue: true
  },
  {
    key: 'retry.maxRetries',
    category: 'network',
    section: '自动重试',
    label: '最大重试次数',
    description: '一次请求在代理层允许重试的次数。',
    kind: 'number',
    defaultValue: 3,
    min: 0
  },
  {
    key: 'retry.baseDelayMs',
    category: 'network',
    section: '自动重试',
    label: '初始重试间隔',
    description: '指数退避的起始等待时间，单位毫秒。',
    kind: 'number',
    defaultValue: 2000,
    min: 0
  },
  {
    key: 'retry.maxAgentDelayMs',
    category: 'network',
    section: '自动重试',
    label: '最大重试间隔',
    description: '代理层两次重试之间的最长等待时间，单位毫秒。',
    kind: 'number',
    defaultValue: 60000,
    min: 0
  },
  {
    key: 'retry.provider.timeoutMs',
    category: 'network',
    section: '提供商重试',
    label: '提供商请求超时',
    description: '单位毫秒。留空时继承 HTTP 空闲超时。',
    kind: 'number',
    min: 0
  },
  {
    key: 'retry.provider.maxRetries',
    category: 'network',
    section: '提供商重试',
    label: '提供商重试次数',
    description: '默认 0，由 SDK 处理配额及用量限制错误。',
    kind: 'number',
    defaultValue: 0,
    min: 0
  },
  {
    key: 'retry.provider.maxRetryDelayMs',
    category: 'network',
    section: '提供商重试',
    label: '服务端等待上限',
    description: '允许服务端要求的最长等待时间，单位毫秒；0 表示不限制。',
    kind: 'number',
    defaultValue: 60000,
    min: 0
  },
  {
    key: 'defaultTools',
    category: 'tools',
    section: '工具',
    label: '默认工具',
    description:
      '每行一个工具名。使用 +powershell、-bash 等条目修改继承的工具列表。显式空列表会禁用内置工具。',
    kind: 'lines',
    defaultValue: ['read', 'bash', 'edit', 'write'],
    placeholder: '-bash\n+powershell'
  },
  {
    key: 'codemode.mode',
    category: 'tools',
    section: '工具',
    label: 'Codemode 模式',
    description: 'on 保留直接工具调用；only 通过 codemode 暴露工具。需要先启用 codemode 工具。',
    kind: 'select',
    defaultValue: 'on',
    options: ['on', 'only']
  },
  {
    key: 'codemode.inlineBudget',
    category: 'tools',
    section: '工具',
    label: 'Codemode 描述预算',
    description: '工具声明可占用的估算 token 数。0 表示仅列出命名空间。',
    kind: 'number',
    defaultValue: 3000,
    min: 0
  },
  {
    key: 'shellCommandPrefix',
    category: 'tools',
    section: 'Shell',
    label: '命令前缀',
    description: '在每条 bash 命令之前添加的内容。',
    kind: 'string'
  },
  {
    key: 'images.autoResize',
    category: 'tools',
    section: '模型图片',
    label: '自动缩放图片',
    description: '发送给模型前，将图片缩放至最大 2000 × 2000 像素。',
    kind: 'boolean',
    defaultValue: true
  },
  {
    key: 'images.blockImages',
    category: 'tools',
    section: '模型图片',
    label: '禁止发送图片',
    description: '阻止工具结果等内容中的图片发送给模型。',
    kind: 'boolean',
    defaultValue: false
  },
  {
    key: 'extensions',
    category: 'resources',
    section: 'eli 资源',
    label: '扩展',
    description: '每行一个本地扩展文件或目录。相对路径从当前 settings.json 所在目录解析。',
    kind: 'lines',
    defaultValue: []
  },
  {
    key: 'skills',
    category: 'resources',
    section: 'eli 资源',
    label: '技能',
    description: '每行一个技能文件或目录。自动加载用户级与项目 .eli/skills。',
    kind: 'lines',
    defaultValue: []
  },
  {
    key: 'prompts',
    category: 'resources',
    section: 'eli 资源',
    label: '提示词模板',
    description: '每行一个提示词模板文件或目录。自动加载用户级与项目 .eli/prompts。',
    kind: 'lines',
    defaultValue: []
  },
  {
    key: 'enableSkillCommands',
    category: 'resources',
    section: 'eli 资源',
    label: '启用技能命令',
    description: '将已加载的技能注册为 /skill:name 命令。',
    kind: 'boolean',
    defaultValue: true
  }
]

export interface AgentSettingsSnapshot {
  values: Record<string, unknown>
}

export interface AgentSettingsChange {
  key: string
  value?: unknown
  reset?: boolean
  expected?: unknown
}

export function settingValue(settings: unknown, key: string): unknown {
  let value = settings
  for (const part of key.split('.')) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined
    value = (value as Record<string, unknown>)[part]
  }
  return value
}
