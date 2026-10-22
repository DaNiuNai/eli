import type { PiToolEvent } from '../../../shared/pi'
import type { ToolCall, ToolResult } from './chat-entries'

export interface ToolDiff {
  text: string
  lines: Array<{ text: string; kind: 'added' | 'removed' | 'default' }>
  added: number
  removed: number | null
  writeContent: boolean
}

export interface ToolState {
  phase: 'streaming' | 'pending' | 'running' | 'success' | 'error' | 'incomplete'
  args: ToolCall['arguments']
  output: Pick<ToolResult, 'content' | 'details'> | undefined
  finished: boolean
  failed: boolean
  active: boolean
  draft?: string
  status: 'error' | 'running' | 'pending' | undefined
}

export function getToolState(
  call: ToolCall,
  event: PiToolEvent | undefined,
  result: ToolResult | undefined,
  running: boolean,
  draft?: string
): ToolState {
  const output: Pick<ToolResult, 'content' | 'details'> | undefined =
    result ??
    (event?.type === 'tool_execution_end'
      ? event.result
      : event?.type === 'tool_execution_update'
        ? event.partialResult
        : undefined)
  const finished = !!result || event?.type === 'tool_execution_end'
  const failed = result ? result.isError : event?.type === 'tool_execution_end' && event.isError
  const phase: ToolState['phase'] = failed
    ? 'error'
    : finished
      ? 'success'
      : !running
        ? 'incomplete'
        : event
          ? 'running'
          : draft !== undefined
            ? 'streaming'
            : 'pending'
  const active = phase === 'streaming' || phase === 'running'
  return {
    phase,
    args: event && 'args' in event ? event.args : call.arguments,
    output,
    finished,
    failed,
    active,
    draft,
    status: failed ? 'error' : active ? 'running' : phase === 'pending' ? 'pending' : undefined
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function getToolTarget(call: ToolCall, args: Record<string, unknown>): string {
  for (const key of ['path', 'file_path', 'command', 'pattern', 'query', 'url']) {
    if (typeof args[key] === 'string' && args[key]) return args[key]
  }
  return call.name
}

export function getToolDiff(
  call: ToolCall,
  args: Record<string, unknown>,
  details: unknown,
  succeeded: boolean
): ToolDiff | null {
  if (!succeeded || (call.name !== 'write' && call.name !== 'edit')) return null
  const record = asRecord(details)
  const diff = typeof record.diff === 'string' ? record.diff : null
  const patch = typeof record.patch === 'string' ? record.patch : null
  // pi 的 diff 带行号，patch 是标准 unified diff；优先采用可读的带行号版本。
  if (diff !== null || patch !== null) {
    const text = diff ?? patch ?? ''
    let inHunk = diff !== null
    const lines = text.split('\n').map((text) => {
      if (patch !== null && diff === null) {
        if (text.startsWith('diff --git ')) inHunk = false
        else if (text.startsWith('@@')) inHunk = true
      }
      return {
        text,
        kind:
          inHunk && text.startsWith('+')
            ? ('added' as const)
            : inHunk && text.startsWith('-')
              ? ('removed' as const)
              : ('default' as const)
      }
    })
    return {
      text,
      lines,
      added: lines.filter((line) => line.kind === 'added').length,
      removed: lines.filter((line) => line.kind === 'removed').length,
      writeContent: false
    }
  }
  if (call.name === 'write' && typeof args.content === 'string') {
    const content = args.content.replace(/\r\n?/g, '\n')
    const lines = content === '' ? [] : content.replace(/\n$/, '').split('\n')
    return {
      text: content,
      lines: lines.map((text, index) => ({ text: `+${index + 1} ${text}`, kind: 'added' })),
      added: lines.length,
      removed: null,
      writeContent: true
    }
  }
  return null
}
