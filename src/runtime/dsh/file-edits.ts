import { createPatch } from 'diff'

export interface Replacement {
  oldText: string
  newText: string
}

/** 所有替换在同一原文上定位；任一条不唯一或重叠时，调用者不会写入文件。 */
export function applyReplacements(original: string, edits: readonly Replacement[]): string {
  if (!edits.length) throw new Error('请至少提供一项替换')
  const crlf = original.includes('\r\n')
  let result = original.replaceAll('\r\n', '\n')
  const spans = edits
    .map(({ oldText, newText }) => {
      const match = oldText.replaceAll('\r\n', '\n')
      const start = result.indexOf(match)
      if (!match || start < 0 || result.indexOf(match, start + 1) >= 0)
        throw new Error('每项 oldText 必须在原文件中唯一匹配')
      return { start, end: start + match.length, text: newText.replaceAll('\r\n', '\n') }
    })
    .sort((a, b) => b.start - a.start)
  let boundary = result.length
  for (const span of spans) {
    if (span.end > boundary) throw new Error('编辑范围重叠，请合并后重试')
    result = result.slice(0, span.start) + span.text + result.slice(span.end)
    boundary = span.start
  }
  return crlf ? result.replaceAll('\n', '\r\n') : result
}

export function diffDetails(
  path: string,
  before: string | null,
  after: string
): { patch?: string } {
  if (before === null) return {}
  const patch = createPatch(path, before, after, undefined, undefined, { context: 3, timeout: 250 })
  return patch ? { patch } : {}
}
