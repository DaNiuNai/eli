export type ToolApprovalMode = 'request' | 'edit' | 'all'

export interface ToolApprovalRequest {
  id: string
  toolCallId: string
  toolName: string
  input: Record<string, unknown>
  parentToolCallId?: string
}

export function isToolApprovalMode(value: unknown): value is ToolApprovalMode {
  return value === 'request' || value === 'edit' || value === 'all'
}

export function automaticallyApproveTool(
  mode: ToolApprovalMode,
  toolName: string,
  readOnly: boolean
): boolean {
  if (mode === 'all') return true
  if (mode === 'edit') return ['read', 'write', 'edit'].includes(toolName)
  return readOnly
}
