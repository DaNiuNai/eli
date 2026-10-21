import { isChatImageReference } from '../../../shared/chat-images'

interface MarkdownNode {
  type: string
  url?: string
  children?: MarkdownNode[]
  position?: { start: { offset?: number }; end: { offset?: number } }
}

function windowsDestination(raw: string, definition: boolean): string | null {
  const marker = definition ? raw.indexOf(']:') : raw.lastIndexOf('](')
  if (marker === -1) return null
  const target = raw.slice(marker + 2).trimStart()
  if (target.startsWith('<')) {
    const end = target.indexOf('>')
    return end === -1 ? null : target.slice(1, end)
  }
  let depth = 0
  let end = 0
  for (; end < target.length; end++) {
    const char = target[end]
    if (/\s/.test(char)) break
    if (char === '(') depth++
    else if (char === ')') {
      if (depth === 0) break
      depth--
    }
  }
  return target.slice(0, end)
}

/** 从原始 Markdown 恢复 Windows 图片路径，避免 \_、\. 等目录分隔被当作转义。 */
export function remarkImagePaths(): (tree: MarkdownNode, file: { value: unknown }) => void {
  return (tree, file) => {
    const source = String(file.value)
    const nodes = [tree]
    while (nodes.length) {
      const node = nodes.pop()!
      if (node.children) nodes.push(...node.children)
      if (
        !['link', 'image', 'definition'].includes(node.type) ||
        !node.url ||
        !/^[a-z]:[\\/]/i.test(node.url)
      )
        continue
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      if (start === undefined || end === undefined) continue
      const path = windowsDestination(source.slice(start, end), node.type === 'definition')
      if (path && /^[a-z]:[\\/]/i.test(path) && isChatImageReference(path)) {
        node.url = path.replaceAll('\\', '/')
      }
    }
  }
}
