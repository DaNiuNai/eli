import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ArrowDownIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@renderer/components/ui/alert'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport
} from '@renderer/components/ui/message-scroller'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { SidebarProvider } from '@renderer/components/ui/sidebar'
import { AppTitlebar } from '@renderer/components/AppTitlebar'
import { AppSettingsDialog } from '@renderer/components/AppSettingsDialog'
import { AgentLoginDialog } from '@renderer/components/AgentLoginDialog'
import { TerminalSetupDialog } from '@renderer/components/TerminalSetupDialog'
import { ChatMessage } from '@renderer/components/ChatMessage'
import { ChatComposer } from '@renderer/components/ChatComposer'
import { ToolApprovalPanel } from '@renderer/components/ToolApprovalPanel'
import { UserQuestionPanel } from '@renderer/components/UserQuestionPanel'
import { AgentSidebar } from '@renderer/components/AgentSidebar'
import { UsageDashboard } from '@renderer/components/UsageDashboard'
import { WorkspaceLayout } from '@renderer/components/WorkspaceLayout'
import { useAgent } from '@renderer/hooks/use-agent'
import { useChatImages } from '@renderer/hooks/use-chat-images'
import { useAgentAuth } from '@renderer/hooks/use-agent-auth'
import { useAgentLibrary } from '@renderer/hooks/use-agent-library'
import { useUserQuestions } from '@renderer/hooks/use-user-questions'
import { useLanguage } from '@renderer/hooks/use-language'
import { buildChatEntries, type ToolResult } from '@renderer/lib/chat-entries'
import { getResponseDisplay } from '@renderer/lib/response-display'
import { restoreWorkspace } from '@renderer/lib/workspace-archive'
import {
  canExecuteSlashCommand,
  executeSlashCommand,
  matchSlashCommand
} from '@renderer/lib/slash-commands'
import {
  getAppPreferences,
  getAppPreferencesError,
  subscribeAppPreferences,
  updateAppPreferences
} from '@renderer/lib/app-preferences'
import type { SavedSession } from '../../shared/agent-library'
import type { AgentMessageTarget } from '../../shared/agent'
import './assets/chat.css'

function App(): React.JSX.Element {
  const { t, language } = useLanguage()
  const { sidebarOpen } = useSyncExternalStore(subscribeAppPreferences, getAppPreferences)
  const preferencesError = useSyncExternalStore(subscribeAppPreferences, getAppPreferencesError)
  const { snapshot, error, perform } = useAgent()
  const userQuestions = useUserQuestions((sessionKey, id, answers) =>
    perform(() => window.api.respondToUserQuestion(sessionKey, id, answers), sessionKey)
  )
  const auth = useAgentAuth()
  const { library, loading, error: libraryError } = useAgentLibrary(snapshot?.libraryVersion)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [settingsOpen, setSettingsOpen] = useState(false)
  const openSettings = useCallback(() => setSettingsOpen(true), [])
  const [sendingSessions, setSendingSessions] = useState<Record<string, number>>({})
  const [commandSessions, setCommandSessions] = useState<Set<string>>(new Set())
  const [stoppingSessions, setStoppingSessions] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<{ target: AgentMessageTarget; text: string } | null>(null)
  const [messageActions, setMessageActions] = useState<Record<string, 'edit' | 'fork'>>({})
  const textarea = useRef<HTMLTextAreaElement>(null)
  const sendingRef = useRef(new Set<string>())
  const commandRef = useRef(new Set<string>())
  const messageActionRef = useRef(new Set<string>())
  const draftKey = snapshot?.sessionKey ?? ''
  const chatImages = useChatImages(draftKey, perform)
  const selectedSessionRef = useRef(draftKey)
  useEffect(() => {
    selectedSessionRef.current = draftKey
  }, [draftKey])
  const sending = sendingSessions[draftKey] !== undefined
  const commandPending = commandSessions.has(draftKey)
  const stopping = stoppingSessions.has(draftKey)
  const messageActionKind = messageActions[draftKey]
  const draft = drafts[draftKey] ?? ''
  const ready = snapshot?.connection === 'ready'
  const workspaceUnavailable = !!snapshot?.unavailableWorkspaces.includes(snapshot.cwd)
  const busy = !!(
    snapshot?.running ||
    snapshot?.pending ||
    sending ||
    commandPending ||
    messageActionKind
  )
  const {
    phase: responsePhase,
    active: responseActive,
    status: responseStatus
  } = getResponseDisplay(snapshot, sendingSessions[draftKey], stopping)
  const messages = snapshot?.messages ?? []
  const visibleMessages = buildChatEntries(
    messages,
    responseActive ? snapshot?.activeThinking : null,
    snapshot?.hideThinkingBlock,
    responseActive ? snapshot?.response.toolCallDrafts : undefined
  )
  if (
    responseStatus &&
    (visibleMessages.at(-1)?.role !== 'assistant' ||
      responsePhase === 'sending' ||
      (visibleMessages.at(-1)?.lastMessageIndex ?? -1) < (snapshot?.response.messageIndex ?? 0))
  ) {
    visibleMessages.push({
      // 提前使用即将到来的助手消息位置，让占位与正文共用同一个滚动条目。
      id: String(
        messages.length +
          (sendingSessions[draftKey] === snapshot?.response.id ||
          messages.length === snapshot?.response.messageIndex
            ? 1
            : 0)
      ),
      lastMessageIndex: -1,
      role: 'assistant',
      groups: []
    })
  }
  const toolResults = new Map<string, ToolResult>()
  for (const message of messages) {
    if (message.role === 'toolResult') toolResults.set(message.toolCallId, message)
  }
  const problem = error || snapshot?.error
  const hasModel = !!snapshot?.models.some(
    (model) => model.provider === snapshot.model?.provider && model.id === snapshot.model.id
  )

  function updateDraft(text: string): void {
    setDrafts((current) => ({ ...current, [draftKey]: text }))
  }

  async function send(): Promise<void> {
    if (chatImages.adding) return
    const command = matchSlashCommand(draft)
    if (command) {
      if (
        commandRef.current.has(draftKey) ||
        !canExecuteSlashCommand(command, { snapshot, busy, commandPending })
      )
        return
      commandRef.current.add(draftKey)
      setCommandSessions((current) => new Set(current).add(draftKey))
      const text = draft
      updateDraft('')
      try {
        const success = await perform(
          () =>
            executeSlashCommand(command, {
              snapshot,
              busy,
              commandPending,
              api: window.api,
              openSettings
            }),
          draftKey
        )
        if (!success)
          setDrafts((current) => ({ ...current, [draftKey]: current[draftKey] || text }))
      } finally {
        commandRef.current.delete(draftKey)
        setCommandSessions((current) => {
          const next = new Set(current)
          next.delete(draftKey)
          return next
        })
      }
      return
    }
    if (
      (!draft.trim() && !chatImages.images.length) ||
      !ready ||
      workspaceUnavailable ||
      busy ||
      !hasModel ||
      sendingRef.current.has(draftKey)
    )
      return
    sendingRef.current.add(draftKey)
    setSendingSessions((current) => ({ ...current, [draftKey]: snapshot?.response.id ?? 0 }))
    const text = draft
    const images = chatImages.images
    updateDraft('')
    const success = await perform(
      () =>
        window.api.prompt(
          draftKey,
          text,
          images.map((image) => image.path)
        ),
      draftKey
    )
    if (success) chatImages.remove(images.map((image) => image.id))
    if (!success) setDrafts((current) => ({ ...current, [draftKey]: current[draftKey] || text }))
    sendingRef.current.delete(draftKey)
    setSendingSessions((current) => {
      const next = { ...current }
      delete next[draftKey]
      return next
    })
    if (selectedSessionRef.current === draftKey) textarea.current?.focus()
  }

  async function stop(): Promise<void> {
    setStoppingSessions((current) => new Set(current).add(draftKey))
    await perform(() => window.api.abort(draftKey), draftKey)
    setStoppingSessions((current) => {
      const next = new Set(current)
      next.delete(draftKey)
      return next
    })
  }

  async function messageAction(
    kind: 'edit' | 'fork',
    action: () => Promise<void>
  ): Promise<boolean> {
    if (!ready || workspaceUnavailable || busy || messageActionRef.current.has(draftKey))
      return false
    messageActionRef.current.add(draftKey)
    setMessageActions((current) => ({ ...current, [draftKey]: kind }))
    if (kind === 'edit') {
      setSendingSessions((current) => ({ ...current, [draftKey]: snapshot?.response.id ?? 0 }))
    }
    try {
      return await perform(action, draftKey)
    } finally {
      messageActionRef.current.delete(draftKey)
      if (kind === 'edit') {
        setSendingSessions((current) => {
          const next = { ...current }
          delete next[draftKey]
          return next
        })
      }
      setMessageActions((current) => {
        const next = { ...current }
        delete next[draftKey]
        return next
      })
    }
  }

  async function sendEdit(): Promise<void> {
    if (!editing || !editing.text.trim() || !hasModel) return
    if (await messageAction('edit', () => window.api.editMessage(editing.target, editing.text))) {
      setEditing((current) => (current === editing ? null : current))
    }
  }

  async function forkMessage(target: AgentMessageTarget): Promise<void> {
    if (await messageAction('fork', () => window.api.forkMessage(target))) {
      setEditing((current) => (current?.target.sessionId === target.sessionId ? null : current))
      if (selectedSessionRef.current === draftKey) textarea.current?.focus()
    }
  }

  async function newSession(cwd?: string): Promise<void> {
    if (await perform(() => window.api.newSession(cwd))) {
      textarea.current?.focus()
    }
  }

  async function openSession(session: SavedSession): Promise<void> {
    await perform(() => window.api.openSession(session.path))
  }

  async function deleteSession(session: SavedSession): Promise<void> {
    await window.api.deleteSession(session.path)
    setDrafts((current) => {
      const next = { ...current }
      const key = snapshot?.liveSessions.find((entry) => entry.path === session.path)?.key
      if (key) delete next[key]
      return next
    })
    const key = snapshot?.liveSessions.find((entry) => entry.path === session.path)?.key
    if (key) chatImages.discard(key)
  }

  async function chooseDirectory(): Promise<void> {
    await perform(async () => {
      const cwd = await window.api.chooseDirectory(language)
      if (cwd) restoreWorkspace(cwd)
    })
  }

  const currentTitle =
    snapshot?.session?.sessionName ||
    snapshot?.liveSessions.find((session) => session.key === draftKey)?.title ||
    library?.sessions.find((session) => session.path === snapshot?.session?.sessionFile)?.title ||
    t('当前对话')

  return (
    <SidebarProvider
      open={sidebarOpen}
      onOpenChange={(open) => updateAppPreferences({ sidebarOpen: open })}
      className="desktop-shell relative h-dvh min-h-0 flex-col overflow-hidden bg-background"
    >
      <AppTitlebar
        title={visibleMessages.length > 0 ? currentTitle : null}
        snapshot={snapshot}
        busy={busy}
        onNewSession={() => void newSession()}
        onChooseDirectory={() => void chooseDirectory()}
        onReconnect={() => void perform(() => window.api.connect(true))}
        onOpenSettings={openSettings}
      />
      <AppSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} login={auth} />
      {auth.terminalSetupOpen ? (
        <TerminalSetupDialog onComplete={auth.completeTerminalSetup} />
      ) : (
        !settingsOpen && <AgentLoginDialog {...auth} />
      )}
      <WorkspaceLayout
        sidebar={
          <AgentSidebar
            snapshot={snapshot}
            library={library}
            loading={loading}
            onNewSession={(cwd) => void newSession(cwd)}
            onOpenSession={(session) => void openSession(session)}
            onDeleteSession={deleteSession}
          />
        }
      >
        <main className="desktop-main flex min-h-0 min-w-0 flex-1 flex-col">
          {(problem || preferencesError) && (
            <div className="mx-auto w-full max-w-4xl shrink-0 px-6 pt-3 sm:px-8">
              {preferencesError && (
                <Alert variant="destructive">
                  <AlertTitle>{t('设置保存失败')}</AlertTitle>
                  <AlertDescription className="max-h-24 overflow-auto whitespace-pre-wrap break-words">
                    {preferencesError}
                  </AlertDescription>
                </Alert>
              )}
              {problem && (
                <Alert variant="destructive">
                  <AlertTitle>{t('需要处理')}</AlertTitle>
                  <AlertDescription className="max-h-24 overflow-auto whitespace-pre-wrap break-words">
                    {t(problem)}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
          <div className="min-h-0 flex-1">
            {visibleMessages.length > 0 ? (
              <MessageScrollerProvider key={snapshot?.sessionKey} autoScroll>
                <MessageScroller>
                  <MessageScrollerViewport aria-label={t('对话消息')}>
                    <MessageScrollerContent className="mx-auto max-w-4xl gap-8 px-6 py-8 sm:px-8">
                      {visibleMessages.map((entry) => {
                        const entryId = snapshot?.messageEntryIds?.[entry.lastMessageIndex]
                        const target =
                          entryId && snapshot?.session
                            ? { sessionId: snapshot.session.sessionId, entryId }
                            : null
                        const isEditing =
                          !!editing &&
                          editing.target.sessionId === target?.sessionId &&
                          editing.target.entryId === target?.entryId
                        return (
                          <MessageScrollerItem
                            key={entry.id}
                            messageId={entry.id}
                            scrollAnchor={entry.role === 'user'}
                          >
                            <ChatMessage
                              entry={entry}
                              results={toolResults}
                              tools={snapshot?.tools ?? {}}
                              running={
                                responseActive &&
                                entry.lastMessageIndex >= (snapshot?.response.messageIndex ?? 0) &&
                                entry === visibleMessages.at(-1)
                              }
                              responseStatus={
                                entry === visibleMessages.at(-1) &&
                                (!snapshot?.userQuestions.length || stopping)
                                  ? responseStatus
                                  : null
                              }
                              actionDisabled={
                                !target ||
                                busy ||
                                !ready ||
                                workspaceUnavailable ||
                                (entry.role === 'user' && !hasModel)
                              }
                              editing={
                                isEditing && editing && !workspaceUnavailable
                                  ? { text: editing.text, busy }
                                  : undefined
                              }
                              onStartEdit={(text) => target && setEditing({ target, text })}
                              onEditChange={(text) =>
                                setEditing((current) => (current ? { ...current, text } : null))
                              }
                              onEditCancel={() => setEditing(null)}
                              onEditSend={() => void sendEdit()}
                              onFork={() => target && void forkMessage(target)}
                            />
                          </MessageScrollerItem>
                        )
                      })}
                      {snapshot?.userQuestions.map((request) => (
                        <MessageScrollerItem key={request.id} messageId={`question:${request.id}`}>
                          <UserQuestionPanel
                            request={request}
                            state={userQuestions.stateFor(request)}
                            disabled={!ready || stopping || workspaceUnavailable}
                            onDraft={(index, draft) =>
                              userQuestions.updateDraft(request, index, draft)
                            }
                            onItemChange={(item) => userQuestions.setItem(request, item)}
                            onSubmit={() => {
                              if (ready && !stopping && !workspaceUnavailable)
                                void userQuestions.submit(draftKey, request)
                            }}
                          />
                        </MessageScrollerItem>
                      ))}
                    </MessageScrollerContent>
                  </MessageScrollerViewport>
                  <MessageScrollerButton aria-label={t('跳转到最新消息')}>
                    <ArrowDownIcon />
                  </MessageScrollerButton>
                </MessageScroller>
              </MessageScrollerProvider>
            ) : (
              <ScrollArea className="h-full">
                <UsageDashboard library={library} loading={loading} error={libraryError} />
              </ScrollArea>
            )}
          </div>
          <ToolApprovalPanel
            key={draftKey}
            requests={snapshot?.toolApprovals ?? []}
            disabled={!ready || stopping}
            onRespond={(id, approved) =>
              perform(() => window.api.respondToToolApproval(draftKey, id, approved), draftKey)
            }
          />
          <ChatComposer
            snapshot={snapshot}
            hasMessages={visibleMessages.length > 0}
            draft={draft}
            images={chatImages.images}
            addingImages={chatImages.adding}
            busy={busy}
            commandPending={commandPending}
            stopping={stopping}
            textarea={textarea}
            onDraft={updateDraft}
            onChooseImages={() => void chatImages.choose()}
            onDropImages={chatImages.addFiles}
            onPasteImages={(files) => chatImages.addFiles(files, true)}
            onRemoveImage={(id) => chatImages.remove([id])}
            onSend={() => void send()}
            onStop={() => void stop()}
            onChooseDirectory={() => void chooseDirectory()}
            onOpenLogin={() => auth.onOpenChange(true)}
            onModel={(provider, id) =>
              void perform(() => window.api.setModel(draftKey, provider, id), draftKey)
            }
            onThinking={(level) =>
              perform(() => window.api.setThinkingLevel(draftKey, level), draftKey)
            }
            onApprovalMode={(toolApprovalMode) => updateAppPreferences({ toolApprovalMode })}
          />
        </main>
      </WorkspaceLayout>
    </SidebarProvider>
  )
}

export default App
