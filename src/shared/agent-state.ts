import type { AgentSessionSnapshot } from './agent'

export function emptySessionSnapshot(
  cwd: string,
  id: string,
  sessionFile?: string
): AgentSessionSnapshot {
  return {
    connection: 'connecting',
    cwd,
    session: { sessionId: id, sessionFile, thinkingLevel: 'medium' },
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
