import type { UiLanguage } from '../../../shared/app-preferences'

export type TranslationValues = Record<string, string | number>
export type Translate = (source: string, values?: TranslationValues) => string

const english: Record<string, string> = {
  本机: 'Local',
  已连接: 'Connected',
  连接失败: 'Connection failed',
  连接中: 'Connecting',
  '本地会话 · 自动保存': 'Local sessions · Auto-saved',
  重新连接: 'Reconnect',
  设置: 'Settings',
  设置保存失败: 'Failed to save settings',
  语言: 'Language',
  关闭: 'Close',
  设置与连接: 'Settings and connection',
  外观: 'Appearance',
  亮色: 'Light',
  暗色: 'Dark',
  跟随系统: 'System',
  主题: 'Theme',
  切换主题: 'Change theme',
  '立即应用并在本机保存。': 'Applied immediately and saved on this device.',
  '选择界面语言。会话内容保持原样。':
    'Choose the interface language. Conversation content stays unchanged.',
  思考强度: 'Reasoning effort',
  模型: 'Model',
  选择模型: 'Select model',
  当前对话: 'Current conversation',
  展开或收起侧栏: 'Toggle sidebar',
  '展开或收起侧栏 · Ctrl+B': 'Toggle sidebar · Ctrl+B',
  需要处理: 'Attention required',
  对话消息: 'Conversation messages',
  跳转到最新消息: 'Jump to latest message',
  工作目录与历史会话: 'Workspaces and session history',
  新对话: 'New conversation',
  新建对话: 'New conversation',
  搜索历史会话: 'Search session history',
  '搜索对话…': 'Search conversations…',
  工作目录: 'Workspace',
  未记录工作目录: 'No recorded workspace',
  拖动调整目录顺序: 'Drag to reorder workspaces',
  拖动调整会话顺序: 'Drag to reorder sessions',
  '在 {directory} 中新建对话': 'New conversation in {directory}',
  没有匹配的对话: 'No matching conversations',
  还没有保存的对话: 'No saved conversations yet',
  对话开始后会显示在这里: 'Conversations will appear here',
  '按空格键开始拖动，使用上下方向键调整位置，再按空格键完成，按 Esc 取消。':
    'Press Space to drag, use the arrow keys to reorder, press Space to drop, or Escape to cancel.',
  '已开始拖动，可使用上下方向键调整顺序。': 'Dragging started. Use the arrow keys to reorder.',
  '正在调整顺序。': 'Reordering.',
  '已取消拖动。': 'Drag canceled.',
  '顺序已保存。': 'Order saved.',
  '删除会话：{title}': 'Delete session: {title}',
  删除会话: 'Delete session',
  '删除此会话？': 'Delete this session?',
  '“{title}”将移入系统回收站，可从回收站恢复。':
    '“{title}” will be moved to the system recycle bin, where it can be restored.',
  取消: 'Cancel',
  '正在删除…': 'Deleting…',
  消息: 'Message',
  '描述一个任务，或者问个问题…': 'Describe a task or ask a question…',
  停止生成: 'Stop generating',
  发送消息: 'Send message',
  'Enter 发送 · Shift + Enter 换行': 'Enter to send · Shift + Enter for a new line',
  尚无可用模型: 'No model available',
  '请先在本机登录或配置模型，再点击侧栏底部的重新连接。':
    'Sign in or configure a model locally, then choose Reconnect from the sidebar menu.',
  选择工作目录: 'Choose workspace',
  正在回复: 'Generating response',
  正在等待回复: 'Waiting for a response',
  正在停止: 'Stopping',
  已停止: 'Stopped',
  正在整理上下文: 'Compacting context',
  执行失败: 'Failed',
  已执行: 'Completed',
  正在执行: 'Running',
  未完成: 'Incomplete',
  思考过程: 'Reasoning',
  '回复失败，请重试。': 'The response failed. Please try again.',
  已停止生成: 'Generation stopped',
  '[图片输出]': '[Image output]',
  '图片：{alt}': 'Image: {alt}',
  未加载: 'Not loaded',
  代码: 'Code',
  复制代码: 'Copy code',
  上下文用量: 'Context usage',
  '上下文用量：等待更新': 'Context usage: waiting for an update',
  '上下文已用 {percent}%': 'Context used: {percent}%',
  '当前对话占用的模型上下文估算。': 'Estimated model context used by this conversation.',
  等待更新: 'Waiting for an update',
  已使用: 'Used',
  暂不可用: 'Unavailable',
  上下文容量: 'Context capacity',
  剩余容量: 'Remaining capacity',
  调整思考强度: 'Adjust reasoning effort',
  恢复默认思考强度: 'Reset reasoning effort',
  '恢复默认：{level}': 'Reset to default: {level}',
  更快: 'Faster',
  更深入: 'Deeper',
  '正在应用…': 'Applying…',
  '默认：{level}': 'Default: {level}',
  关闭思考: 'Off',
  极简: 'Minimal',
  低: 'Low',
  中: 'Medium',
  高: 'High',
  极高: 'Extra high',
  最高: 'Maximum',
  工作概览: 'Work overview',
  本机使用记录: 'Local usage history',
  ' · {workspaces} 个工作目录 · {sessions} 个已保存会话':
    ' · {workspaces} workspaces · {sessions} saved sessions',
  用量统计: 'Usage statistics',
  '根据本地会话文件统计，包含缓存用量，分支继承的相同条目去重。':
    'Based on local sessions, including cached tokens and deduplicated branch entries.',
  活跃会话: 'Active sessions',
  所选时段内有独立消息或用量记录的会话:
    'Sessions with unique messages or usage in the selected period',
  '用户消息与助手消息，不包含工具结果': 'User and assistant messages, excluding tool results',
  '总 Token': 'Total tokens',
  '输入、输出、缓存读取与缓存写入之和': 'Input, output, cache reads, and cache writes combined',
  活跃天数: 'Active days',
  有消息或用量记录的自然日: 'Calendar days with messages or usage',
  最活跃时段: 'Peak hour',
  '按本地时间统计，消息最多的小时': 'The hour with the most messages in local time',
  常用模型: 'Top model',
  尚无模型调用记录: 'No model requests recorded yet',
  概览: 'Overview',
  统计时间范围: 'Usage period',
  全部: 'All time',
  '30 天': '30 days',
  '7 天': '7 days',
  '最近 26 周的活动记录，按本地时间统计': 'Activity over the last 26 weeks in local time',
  '最近 26 周的用量热力图，所选时段共 {days} 个活跃日':
    'Usage heatmap for the last 26 weeks; {days} active days in the selected period',
  '{date} · {messages} 条消息 · {tokens} Token': '{date} · {messages} messages · {tokens} tokens',
  '输入 {input} · 输出 {output} · 缓存 {cache}': 'Input {input} · Output {output} · Cache {cache}',
  暂无已保存的用量记录: 'No saved usage records yet',
  少: 'Less',
  多: 'More',
  回复: 'Replies',
  记录费用: 'Recorded cost',
  '正在读取模型用量…': 'Loading model usage…',
  所选时段还没有模型用量记录: 'No model usage in the selected period',
  'Token 包含缓存用量，相同分支记录已去重':
    'Includes cached tokens; shared branch entries are deduplicated',
  '热力图：近 26 周 · 记录去重': 'Heatmap: last 26 weeks · Deduplicated',
  '更新中…': 'Updating…',
  '更新于 {time}': 'Updated at {time}',
  等待本地记录: 'Waiting for local records',
  '请通过 pnpm dev 启动桌面应用，浏览器预览无法连接本机服务。':
    'Open the desktop application to connect to the local service.',
  请选择有效的历史会话: 'Select a valid saved session',
  无效的界面语言: 'Invalid interface language',
  无效的请求来源: 'Invalid request source',
  '该会话不在本机历史记录中，请刷新列表':
    'This session is no longer in the local history. Refresh the list.',
  请等待当前操作完成: 'Wait for the current operation to finish',
  '本机服务尚未连接，请重新连接': 'The local service is disconnected. Please reconnect.',
  扩展取消了切换会话: 'An extension canceled switching sessions',
  扩展取消了新建对话: 'An extension canceled creating a new conversation',
  '扩展取消了新建对话，未删除原会话':
    'An extension canceled the new conversation. The original session was kept.',
  请先停止当前操作: 'Stop the current operation first',
  请选择可用的模型: 'Select an available model',
  当前模型不支持该思考强度: 'The current model does not support this reasoning effort',
  无效的工作目录: 'Invalid workspace',
  请选择已有工作目录: 'Select an existing workspace',
  工作目录不存在或无法访问: 'The workspace does not exist or cannot be accessed',
  '请输入 1 至 100000 个字符的消息': 'Enter a message between 1 and 100000 characters',
  '请先配置模型，再重新连接': 'Configure a model first, then reconnect',
  '此扩展需要交互，请在命令行中完成。可停止或重新连接。':
    'This extension requires interaction in the command line. You can stop or reconnect.'
}

export function translate(
  source: string,
  language: UiLanguage,
  values: TranslationValues = {}
): string {
  const clean = source.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
  let result = language === 'en' ? (english[clean] ?? clean) : clean
  if (language === 'en' && result === clean) {
    result = result
      .replace(/^正在执行 (.+)$/, 'Running $1')
      .replace(/^正在重试（(\d+)\/(\d+)）$/, 'Retrying ($1/$2)')
      .replace(
        /^(\d+) 个会话存在无法读取或尚未写完的记录，统计可能暂不完整。$/,
        '$1 sessions contain unreadable or incomplete records. Usage may be incomplete.'
      )
  }
  for (const [key, value] of Object.entries(values)) {
    result = result.replaceAll(`{${key}}`, String(value))
  }
  return result
}
