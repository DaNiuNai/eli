import type { PiThinkingLevel } from '../../../shared/pi'

export function directoryName(path: string, fallback = '工作目录'): string {
  return (
    path
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .at(-1) ||
    path ||
    fallback
  )
}

export function compactNumber(value: number): string {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(
    value
  )
}

export const thinkingLabels: Record<PiThinkingLevel, string> = {
  off: '关闭思考',
  minimal: '极简',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最高'
}
