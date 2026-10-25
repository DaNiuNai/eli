import {
  FilePenLineIcon,
  MessageCircleQuestionIcon,
  SearchIcon,
  TerminalIcon,
  WrenchIcon
} from 'lucide-react'
import type { AgentToolEvent } from '../../../shared/agent'
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle
} from '@renderer/components/ui/trace'
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle
} from '@renderer/components/ui/code-block'
import { useLanguage } from '@renderer/hooks/use-language'
import type { ToolCall, ToolResult, TracePart } from '@renderer/lib/chat-entries'
import { getToolDiff, getToolState, getToolTarget, type ToolDiff } from '@renderer/lib/tool-display'
import { ChatMarkdown } from './ChatMarkdown'

const toolActions: Record<string, string> = {
  ask_user_question: '询问用户',
  bash: '运行命令',
  powershell: '运行命令',
  get_task: '查询后台任务',
  list_tasks: '列出后台任务',
  stop_task: '停止后台任务',
  read: '读取文件',
  write: '写入文件',
  edit: '编辑文件',
  grep: '搜索内容',
  find: '查找文件',
  ls: '列出目录'
}

const summaryActions: Record<string, string> = {
  ask_user_question: '询问用户 {count} 次',
  bash: '运行 {count} 条命令',
  powershell: '运行 {count} 条命令',
  get_task: '查询 {count} 个后台任务',
  list_tasks: '列出后台任务 {count} 次',
  stop_task: '停止 {count} 个后台任务',
  read: '读取 {count} 个文件',
  write: '写入 {count} 个文件',
  edit: '编辑 {count} 个文件',
  grep: '搜索 {count} 次内容',
  find: '查找 {count} 次文件',
  ls: '列出 {count} 次目录'
}

function ToolCode({
  title,
  value,
  failed = false
}: {
  title: string
  value: string
  failed?: boolean
}): React.JSX.Element {
  const { t } = useLanguage()
  return (
    <CodeBlock size="sm" variant={failed ? 'destructive' : 'default'}>
      <CodeBlockHeader>
        <CodeBlockTitle>{title}</CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value={value} aria-label={t('复制{title}', { title })} />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent wrap className="max-h-80">
        {value}
      </CodeBlockContent>
    </CodeBlock>
  )
}

function DiffStats({ added, removed }: Pick<ToolDiff, 'added' | 'removed'>): React.JSX.Element {
  const { t } = useLanguage()
  return (
    <TraceDescription
      className="tool-diff-stats"
      title={
        removed === null
          ? t('新增或写入 {added} 行；覆盖前的删除行数未知', { added })
          : t('新增 {added} 行，删除 {removed} 行', { added, removed })
      }
    >
      <span data-diff="added">+{added}</span> <span data-diff="removed">−{removed ?? '?'}</span>
    </TraceDescription>
  )
}

function ToolDiffView({ diff, path }: { diff: ToolDiff; path: string }): React.JSX.Element {
  const { t } = useLanguage()
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {diff.writeContent && (
        <p className="text-xs text-muted-foreground">
          {t('写入 {count} 行。工具未提供旧版本，无法计算覆盖前的删除行数。', {
            count: diff.added
          })}
        </p>
      )}
      <CodeBlock size="sm" className="tool-diff">
        <CodeBlockHeader>
          <CodeBlockTitle title={path}>
            {t(diff.writeContent ? '写入内容' : '文件差异')} · {path}
          </CodeBlockTitle>
          <CodeBlockActions>
            <CodeBlockCopyButton
              value={diff.text}
              aria-label={t(diff.writeContent ? '复制写入内容' : '复制文件差异')}
            />
          </CodeBlockActions>
        </CodeBlockHeader>
        <CodeBlockContent className="max-h-96" aria-label={t('文件变更内容')}>
          {diff.lines.map((line, index) => (
            <CodeBlockLine key={index} variant={line.kind}>
              {line.text}
            </CodeBlockLine>
          ))}
        </CodeBlockContent>
      </CodeBlock>
    </div>
  )
}

type ToolState = ReturnType<typeof getToolState>
interface ToolItem {
  call: ToolCall
  state: ToolState
  diff: ToolDiff | null
}

const toolPhaseLabels: Record<ToolState['phase'], string> = {
  streaming: '正在生成工具调用',
  pending: '等待执行',
  running: '正在执行',
  success: '已执行',
  error: '执行失败',
  incomplete: '未完成'
}

function ToolCallView({ call, state, diff }: ToolItem): React.JSX.Element {
  const { t } = useLanguage()
  const target = getToolTarget(call, state.args)
  const action = t(toolActions[call.name] ?? '调用工具')
  const details = state.output?.details as { status?: string } | undefined
  const background =
    state.finished && ['bash', 'powershell'].includes(call.name) && details?.status === 'running'
  const label = `${t(background ? '已转入后台' : toolPhaseLabels[state.phase])} · ${action}`
  const Icon =
    call.name === 'ask_user_question'
      ? MessageCircleQuestionIcon
      : ['bash', 'powershell', 'get_task', 'list_tasks', 'stop_task'].includes(call.name)
        ? TerminalIcon
        : call.name === 'write' || call.name === 'edit'
          ? FilePenLineIcon
          : call.name === 'grep' || call.name === 'find'
            ? SearchIcon
            : WrenchIcon
  const output = state.output

  return (
    <TraceCollapsible className="tool-call" defaultOpen={false}>
      <TraceCollapsibleTrigger className="tool-call-trigger" title={`${label} · ${target}`}>
        <TraceLine status={state.status}>
          <TraceIcon>
            <Icon />
          </TraceIcon>
          <TraceTitle>
            {label} · {target}
          </TraceTitle>
          {diff && <DiffStats added={diff.added} removed={diff.removed} />}
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="tool-call-content">
        <div className="flex min-w-0 flex-col gap-3">
          {diff && <ToolDiffView diff={diff} path={target} />}
          <ToolCode
            title={`${t('调用参数')} · ${call.name}`}
            value={
              state.draft !== undefined ? state.draft || '…' : JSON.stringify(state.args, null, 2)
            }
          />
          {output ? (
            <>
              <ToolCode
                title={t(state.phase === 'running' ? '实时输出' : '返回结果')}
                value={
                  output.content
                    .filter((part) => part.type === 'text')
                    .map((part) => part.text)
                    .join('\n') || t('无文本输出')
                }
                failed={state.failed}
              />
              {output.content.map((part, index) =>
                part.type === 'image' ? (
                  <img
                    key={index}
                    src={`data:${part.mimeType};base64,${part.data}`}
                    alt={t('工具返回的图片')}
                    className="max-h-96 max-w-full self-start rounded-md object-contain"
                  />
                ) : null
              )}
              {output.details !== undefined && (
                <ToolCode title={t('结果详情')} value={JSON.stringify(output.details, null, 2)} />
              )}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t(
                state.phase === 'streaming'
                  ? '正在生成工具调用参数…'
                  : state.phase === 'pending'
                    ? '工具调用已生成，等待执行…'
                    : state.phase === 'running'
                      ? '等待工具返回结果…'
                      : '暂无工具返回结果'
              )}
            </p>
          )}
        </div>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  )
}

function ThinkingView({
  part,
  running
}: {
  part: Extract<TracePart, { type: 'thinking' }>
  running: boolean
}): React.JSX.Element {
  const { t } = useLanguage()
  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>
        <TraceLine status={running && part.pending ? 'running' : undefined}>
          <TraceTitle>{t(running && part.pending ? '正在思考' : '思考过程')}</TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <ChatMarkdown text={part.text} />
      </TraceCollapsibleContent>
    </TraceCollapsible>
  )
}

export function ToolActivity({
  parts,
  results,
  tools,
  running
}: {
  parts: TracePart[]
  results: Map<string, ToolResult>
  tools: Record<string, AgentToolEvent>
  running: boolean
}): React.JSX.Element {
  const { t } = useLanguage()
  const calls = new Map<string, ToolItem>()
  const counts = new Map<string, number>()
  let active = false
  let streaming = false
  let pending = false
  let incomplete = false
  let added = 0
  let removed: number | null = 0
  let hasDiff = false
  for (const part of parts) {
    if (part.type !== 'toolCall') continue
    const { call } = part
    const state = getToolState(call, tools[call.id], results.get(call.id), running, part.draft)
    const diff = getToolDiff(
      call,
      state.args,
      state.output?.details,
      state.finished && !state.failed
    )
    calls.set(call.id, { call, state, diff })
    counts.set(call.name, (counts.get(call.name) ?? 0) + 1)
    if (state.active) active = true
    if (state.phase === 'streaming') streaming = true
    if (state.phase === 'pending') pending = true
    if (state.phase === 'incomplete') incomplete = true
    if (diff) {
      hasDiff = true
      added += diff.added
      removed = removed === null || diff.removed === null ? null : removed + diff.removed
    }
  }
  const lastPart = parts.at(-1)
  // 末尾的思考保持可见；即使前面已有工具组，也能展开查看当前流式内容。
  const trailingThinking = lastPart?.type === 'thinking' ? lastPart : null
  const listParts = calls.size >= 2 && trailingThinking ? parts.slice(0, -1) : parts
  const rows = (
    <Trace className="tool-activity-list">
      {listParts.map((part) =>
        part.type === 'thinking' ? (
          <ThinkingView key={part.id} part={part} running={running} />
        ) : (
          <ToolCallView key={part.id} {...calls.get(part.id)!} />
        )
      )}
    </Trace>
  )
  if (calls.size < 2) return rows

  const summary = [...counts]
    .slice(0, 3)
    .map(([name, count]) => t(summaryActions[name] ?? '{count} 次 {name} 调用', { count, name }))
  const remaining = [...counts.values()].slice(3).reduce((sum, count) => sum + count, 0)
  if (remaining) summary.push(t('另有 {count} 次操作', { count: remaining }))
  const phase: ToolState['phase'] = streaming
    ? 'streaming'
    : active
      ? 'running'
      : pending
        ? 'pending'
        : incomplete
          ? 'incomplete'
          : 'success'

  return (
    <Trace className="tool-activity">
      <TraceCollapsible defaultOpen={false}>
        <TraceCollapsibleTrigger className="tool-activity-trigger">
          <TraceLine status={active ? 'running' : pending ? 'pending' : undefined}>
            <TraceTitle title={summary.join('，')}>
              {t(toolPhaseLabels[phase])} · {summary.join('，')}
            </TraceTitle>
            {hasDiff && <DiffStats added={added} removed={removed} />}
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="tool-activity-content">{rows}</TraceCollapsibleContent>
      </TraceCollapsible>
      {trailingThinking && (
        <ThinkingView key={trailingThinking.id} part={trailingThinking} running={running} />
      )}
    </Trace>
  )
}
