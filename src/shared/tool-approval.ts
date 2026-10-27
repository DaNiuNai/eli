export type ToolApprovalMode = 'request' | 'edit' | 'auto' | 'all'

export interface AutoApprovalModel {
  provider: string
  id: string
}

export interface AutoApprovalState {
  reviewing: number
  paused: boolean
  lastDenied: { toolName: string; reason: string } | null
}

export interface ToolApprovalRequest {
  id: string
  agentId?: string
  toolCallId: string
  toolName: string
  input: Record<string, unknown>
  parentToolCallId?: string
  description?: string
  reason?: string
}

export function isToolApprovalMode(value: unknown): value is ToolApprovalMode {
  return value === 'request' || value === 'edit' || value === 'auto' || value === 'all'
}

export function parseAutoApprovalModel(value: unknown): AutoApprovalModel | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('无效的自动批准模型')
  const { provider, id } = value as Record<string, unknown>
  if (
    typeof provider !== 'string' ||
    !provider.trim() ||
    provider.length > 300 ||
    typeof id !== 'string' ||
    !id.trim() ||
    id.length > 300
  )
    throw new Error('无效的自动批准模型')
  return { provider, id }
}

export function automaticallyApproveTool(
  mode: ToolApprovalMode,
  toolName: string,
  readOnly: boolean
): boolean {
  if (mode === 'all') return true
  if (mode === 'auto') return false
  if (mode === 'edit') return ['read', 'write', 'edit'].includes(toolName)
  return readOnly
}
