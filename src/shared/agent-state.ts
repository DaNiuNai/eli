import type { AgentSessionSnapshot } from './agent'

export function emptySessionSnapshot(
  cwd = '',
  id?: string,
  sessionFile?: string
): AgentSessionSnapshot {
  return {
    connection: id ? 'connecting' : 'ready',
    cwd,
    session: id ? { sessionId: id, sessionFile, thinkingLevel: 'medium' } : null,
    thinkingLevels: [],
    contextUsage: null,
    model: null,
    models: [],
    messages: [],
    messageEntryIds: [],
    activeThinking: null,
    response: { id: 0, messageIndex: 0, phase: 'idle', toolCallDrafts: {} },
    tools: {},
    backgroundTasks: [],
    subagents: [],
    toolApprovals: [],
    autoApproval: { reviewing: 0, paused: false, lastDenied: null },
    userQuestions: [],
    running: false,
    pending: false,
    activity: '',
    error: null,
    hideThinkingBlock: false
  }
}
