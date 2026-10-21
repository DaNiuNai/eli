import { useRef, useState, type CSSProperties } from 'react'
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
import { SidebarProvider, SidebarTrigger } from '@renderer/components/ui/sidebar'
import { ChatMessage } from '@renderer/components/ChatMessage'
import { ChatComposer } from '@renderer/components/ChatComposer'
import { PiSidebar } from '@renderer/components/PiSidebar'
import { UsageDashboard } from '@renderer/components/UsageDashboard'
import { usePi } from '@renderer/hooks/use-pi'
import { usePiLibrary } from '@renderer/hooks/use-pi-library'
import { useLanguage } from '@renderer/hooks/use-language'
import { cn } from '@renderer/lib/utils'
import type { SavedSession } from '../../shared/pi-library'
import './assets/chat.css'

function App(): React.JSX.Element {
  const { t, language } = useLanguage()
  const { snapshot, error, perform } = usePi()
  const { library, loading, error: libraryError } = usePiLibrary(snapshot?.libraryVersion)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [sending, setSending] = useState(false)
  const [stopping, setStopping] = useState(false)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const sendingRef = useRef(false)
  const draftKey = `${snapshot?.cwd ?? ''}:${snapshot?.session?.sessionId ?? ''}`
  const draft = drafts[draftKey] ?? ''
  const ready = snapshot?.connection === 'ready'
  const busy = !!(snapshot?.running || snapshot?.pending || sending)
  const messages = snapshot?.messages ?? []
  const visibleMessages = messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => message.role === 'user' || message.role === 'assistant')
  const problem = error || snapshot?.error
  const hasModel = !!snapshot?.models.some(
    (model) => model.provider === snapshot.model?.provider && model.id === snapshot.model.id
  )

  function updateDraft(text: string): void {
    setDrafts((current) => ({ ...current, [draftKey]: text }))
  }

  async function send(): Promise<void> {
    if (!draft.trim() || !ready || busy || !hasModel || sendingRef.current) return
    sendingRef.current = true
    setSending(true)
    const text = draft
    updateDraft('')
    const success = await perform(() => window.api.prompt(text))
    if (!success) setDrafts((current) => ({ ...current, [draftKey]: current[draftKey] || text }))
    sendingRef.current = false
    setSending(false)
    textarea.current?.focus()
  }

  async function stop(): Promise<void> {
    setStopping(true)
    await perform(() => window.api.abort())
    setStopping(false)
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
      delete next[`${session.cwd}:${session.id}`]
      return next
    })
  }

  async function chooseDirectory(): Promise<void> {
    await perform(() => window.api.chooseDirectory(language))
  }

  const currentTitle =
    snapshot?.session?.sessionName ||
    library?.sessions.find((session) => session.path === snapshot?.session?.sessionFile)?.title ||
    t('当前对话')

  return (
    <SidebarProvider
      className="desktop-shell relative h-dvh min-h-0 flex-col overflow-hidden bg-background"
      style={{ '--sidebar-width': '17rem' } as CSSProperties}
    >
      <header
        className={cn(
          'desktop-titlebar flex items-center px-2',
          window.windowAppearance?.customTitleBar && 'window-titlebar'
        )}
      >
        <div className="window-titlebar-actions flex items-center gap-1">
          <SidebarTrigger
            className="desktop-sidebar-toggle"
            aria-label={t('展开或收起侧栏')}
            title={t('展开或收起侧栏 · Ctrl+B')}
          />
        </div>
        {visibleMessages.length > 0 && (
          <span className="ml-4 max-w-[50%] truncate text-xs text-muted-foreground">
            {currentTitle}
          </span>
        )}
      </header>
      <div className="flex min-h-0 flex-1">
        <PiSidebar
          snapshot={snapshot}
          library={library}
          loading={loading}
          busy={busy}
          onNewSession={(cwd) => void newSession(cwd)}
          onOpenSession={(session) => void openSession(session)}
          onDeleteSession={deleteSession}
          onReconnect={() => void perform(() => window.api.connect(true))}
        />
        <main className="desktop-main flex min-h-0 min-w-0 flex-1 flex-col">
          {problem && (
            <div className="mx-auto w-full max-w-4xl shrink-0 px-6 pt-3 sm:px-8">
              <Alert variant="destructive">
                <AlertTitle>{t('需要处理')}</AlertTitle>
                <AlertDescription className="max-h-24 overflow-auto whitespace-pre-wrap break-words">
                  {t(problem)}
                </AlertDescription>
              </Alert>
            </div>
          )}
          <div className="min-h-0 flex-1">
            {visibleMessages.length > 0 ? (
              <MessageScrollerProvider key={snapshot?.session?.sessionId} autoScroll>
                <MessageScroller>
                  <MessageScrollerViewport aria-label={t('对话消息')}>
                    <MessageScrollerContent className="mx-auto max-w-4xl gap-8 px-6 py-8 sm:px-8">
                      {visibleMessages.map(({ message, index }) => (
                        <MessageScrollerItem
                          key={index}
                          messageId={String(index)}
                          scrollAnchor={message.role === 'user'}
                        >
                          <ChatMessage
                            message={message}
                            messages={messages}
                            tools={snapshot?.tools ?? {}}
                            running={!!snapshot?.running}
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
          <ChatComposer
            snapshot={snapshot}
            draft={draft}
            busy={busy}
            stopping={stopping}
            textarea={textarea}
            onDraft={updateDraft}
            onSend={() => void send()}
            onStop={() => void stop()}
            onChooseDirectory={() => void chooseDirectory()}
            onModel={(provider, id) => void perform(() => window.api.setModel(provider, id))}
            onThinking={(level) => perform(() => window.api.setThinkingLevel(level))}
          />
        </main>
      </div>
    </SidebarProvider>
  )
}

export default App
