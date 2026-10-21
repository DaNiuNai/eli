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
import { PiLoginDialog } from '@renderer/components/PiLoginDialog'
import { ChatMessage } from '@renderer/components/ChatMessage'
import { ChatComposer } from '@renderer/components/ChatComposer'
import { PiSidebar } from '@renderer/components/PiSidebar'
import { UsageDashboard } from '@renderer/components/UsageDashboard'
import { WorkspaceLayout } from '@renderer/components/WorkspaceLayout'
import { usePi } from '@renderer/hooks/use-pi'
import { usePiAuth } from '@renderer/hooks/use-pi-auth'
import { usePiLibrary } from '@renderer/hooks/use-pi-library'
import { useLanguage } from '@renderer/hooks/use-language'
import { buildChatEntries, type ToolResult } from '@renderer/lib/chat-entries'
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
import type { SavedSession } from '../../shared/pi-library'
import type { PiMessageTarget } from '../../shared/pi'
import './assets/chat.css'

function App(): React.JSX.Element {
  const { t, language } = useLanguage()
  const { sidebarOpen } = useSyncExternalStore(subscribeAppPreferences, getAppPreferences)
  const preferencesError = useSyncExternalStore(subscribeAppPreferences, getAppPreferencesError)
  const { snapshot, error, perform } = usePi()
  const auth = usePiAuth()
  const { library, loading, error: libraryError } = usePiLibrary(snapshot?.libraryVersion)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [settingsOpen, setSettingsOpen] = useState(false)
  const openSettings = useCallback(() => setSettingsOpen(true), [])
  const [sendingSessions, setSendingSessions] = useState<Set<string>>(new Set())
  const [commandSessions, setCommandSessions] = useState<Set<string>>(new Set())
  const [stoppingSessions, setStoppingSessions] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<{ target: PiMessageTarget; text: string } | null>(null)
  const [messageActions, setMessageActions] = useState<Record<string, 'edit' | 'fork'>>({})
  const textarea = useRef<HTMLTextAreaElement>(null)
  const sendingRef = useRef(new Set<string>())
  const commandRef = useRef(new Set<string>())
  const messageActionRef = useRef(new Set<string>())
  const draftKey = snapshot?.sessionKey ?? ''
  const selectedSessionRef = useRef(draftKey)
  useEffect(() => {
    selectedSessionRef.current = draftKey
  }, [draftKey])
  const sending = sendingSessions.has(draftKey)
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
  const processing =
    !stopping &&
    (snapshot?.running ? snapshot.activity === '正在处理' : sending || messageActionKind === 'edit')
  const messages = snapshot?.messages ?? []
  const visibleMessages = buildChatEntries(
    messages,
    snapshot?.running ? snapshot.activeThinking : null,
    snapshot?.hideThinkingBlock
  )
  if (processing && visibleMessages.at(-1)?.role !== 'assistant') {
    visibleMessages.push({ id: 'processing', lastMessageIndex: -1, role: 'assistant', groups: [] })
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
      !draft.trim() ||
      !ready ||
      workspaceUnavailable ||
      busy ||
      !hasModel ||
      sendingRef.current.has(draftKey)
    )
      return
    sendingRef.current.add(draftKey)
    setSendingSessions((current) => new Set(current).add(draftKey))
    const text = draft
    updateDraft('')
    const success = await perform(() => window.api.prompt(draftKey, text), draftKey)
    if (!success) setDrafts((current) => ({ ...current, [draftKey]: current[draftKey] || text }))
    sendingRef.current.delete(draftKey)
    setSendingSessions((current) => {
      const next = new Set(current)
      next.delete(draftKey)
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
    try {
      return await perform(action, draftKey)
    } finally {
      messageActionRef.current.delete(draftKey)
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

  async function forkMessage(target: PiMessageTarget): Promise<void> {
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
        onOpenLogin={() => auth.onOpenChange(true)}
      />
      <AppSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <PiLoginDialog {...auth} />
      <WorkspaceLayout
        sidebar={
          <PiSidebar
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
                              running={!!snapshot?.running && entry === visibleMessages.at(-1)}
                              processing={processing && entry === visibleMessages.at(-1)}
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
          <ChatComposer
            snapshot={snapshot}
            draft={draft}
            busy={busy}
            commandPending={commandPending}
            stopping={stopping}
            textarea={textarea}
            onDraft={updateDraft}
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
          />
        </main>
      </WorkspaceLayout>
    </SidebarProvider>
  )
}

export default App
