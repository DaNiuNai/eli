import { useRef, useState } from 'react'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  FolderOpenIcon,
  PlusIcon,
  RotateCwIcon,
  SquareIcon
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@renderer/components/ui/alert'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@renderer/components/ui/empty'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea
} from '@renderer/components/ui/input-group'
import { NativeSelect, NativeSelectOption } from '@renderer/components/ui/native-select'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport
} from '@renderer/components/ui/message-scroller'
import { Trace, TraceIcon, TraceLine, TraceTitle } from '@renderer/components/ui/trace'
import { Spinner } from '@renderer/components/ui/spinner'
import { ChatMessage } from '@renderer/components/ChatMessage'
import { usePi } from '@renderer/hooks/use-pi'
import './assets/chat.css'

function App(): React.JSX.Element {
  const { snapshot, error, perform } = usePi()
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [stopping, setStopping] = useState(false)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const sendingRef = useRef(false)
  const ready = snapshot?.connection === 'ready'
  const busy = !!(snapshot?.running || snapshot?.pending || sending)
  const messages = snapshot?.messages ?? []
  const visibleMessages = messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => message.role === 'user' || message.role === 'assistant')
  const problem = error || snapshot?.error
  const modelKey = snapshot?.model
    ? JSON.stringify([snapshot.model.provider, snapshot.model.id])
    : ''
  const hasModel = !!snapshot?.models.some(
    (model) => model.provider === snapshot.model?.provider && model.id === snapshot.model.id
  )

  async function send(): Promise<void> {
    if (!draft.trim() || !ready || busy || !hasModel || sendingRef.current) return
    sendingRef.current = true
    setSending(true)
    const text = draft
    setDraft('')
    const success = await perform(() => window.api.prompt(text))
    if (!success) setDraft((current) => current || text)
    sendingRef.current = false
    setSending(false)
    textarea.current?.focus()
  }

  async function stop(): Promise<void> {
    setStopping(true)
    await perform(() => window.api.abort())
    setStopping(false)
  }

  return (
    <main className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b px-6 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="pi-wordmark" aria-label="pi">
            π
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <h1 className="truncate text-sm font-semibold">ixov</h1>
            <p className="text-xs text-muted-foreground">与 pi 一起，把想法变成现实</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={ready ? 'secondary' : 'outline'}>
            {ready ? '已连接' : snapshot?.connection === 'error' ? '连接失败' : '连接中'}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            disabled={!ready || busy}
            onClick={() => void perform(() => window.api.newSession())}
          >
            <PlusIcon data-icon="inline-start" />
            新对话
          </Button>
        </div>
      </header>

      <div className="flex shrink-0 items-center justify-between gap-3 px-6 py-2">
        <Button
          variant="ghost"
          size="sm"
          className="min-w-0 max-w-[75%]"
          title={snapshot?.cwd || '选择工作目录'}
          disabled={busy || snapshot?.connection === 'connecting' || !snapshot}
          onClick={() => void perform(() => window.api.chooseDirectory())}
        >
          <FolderOpenIcon data-icon="inline-start" />
          <span className="truncate">{snapshot?.cwd || '正在连接本机 pi…'}</span>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="重新连接"
          title="重新连接 pi"
          disabled={busy || snapshot?.connection === 'connecting' || !window.api}
          onClick={() => void perform(() => window.api.connect(true))}
        >
          <RotateCwIcon />
        </Button>
      </div>

      {problem && (
        <div className="mx-auto w-full max-w-4xl shrink-0 px-6 py-2">
          <Alert variant="destructive">
            <AlertTitle>需要处理</AlertTitle>
            <AlertDescription className="max-h-32 overflow-auto whitespace-pre-wrap break-words">
              {problem}
            </AlertDescription>
          </Alert>
        </div>
      )}

      <div className="min-h-0 flex-1">
        {visibleMessages.length === 0 ? (
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyMedia>
                <span className="pi-hero" aria-hidden="true">
                  π
                </span>
              </EmptyMedia>
              <EmptyTitle>从一个想法开始</EmptyTitle>
              <EmptyDescription>
                提问、探索代码，或一起完成下一件事。
                <br />
                pi 会在上方的工作目录中与你协作。
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <MessageScrollerProvider key={snapshot?.session?.sessionId} autoScroll>
            <MessageScroller>
              <MessageScrollerViewport aria-label="对话消息">
                <MessageScrollerContent className="mx-auto max-w-4xl gap-8 px-8 py-8">
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
              <MessageScrollerButton aria-label="跳转到最新消息">
                <ArrowDownIcon />
              </MessageScrollerButton>
            </MessageScroller>
          </MessageScrollerProvider>
        )}
      </div>

      <footer className="mx-auto flex w-full max-w-4xl shrink-0 flex-col gap-3 px-6 pb-5 pt-3">
        <div className="min-h-5" role="status" aria-live="polite">
          {snapshot?.running && (
            <Trace>
              <TraceLine status="running">
                <TraceIcon>
                  <Spinner />
                </TraceIcon>
                <TraceTitle>{snapshot.activity || '正在回复'}</TraceTitle>
              </TraceLine>
            </Trace>
          )}
        </div>
        {ready && !hasModel && (
          <Alert>
            <AlertTitle>尚无可用模型</AlertTitle>
            <AlertDescription>
              请先在本机 pi 中登录或配置模型，然后点击右上方的重新连接。
            </AlertDescription>
          </Alert>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void send()
          }}
        >
          <InputGroup>
            <InputGroupTextarea
              ref={textarea}
              aria-label="消息"
              placeholder="告诉 pi，你想做什么…"
              className="max-h-52 min-h-24 px-4 py-3"
              value={draft}
              maxLength={100000}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing &&
                  event.keyCode !== 229
                ) {
                  event.preventDefault()
                  void send()
                }
              }}
            />
            <InputGroupAddon align="block-end" className="justify-between gap-3 px-3 pb-3">
              <NativeSelect
                aria-label="模型"
                className="max-w-[75%]"
                value={modelKey}
                disabled={!ready || busy || !snapshot?.models.length}
                onChange={(event) => {
                  const [provider, id] = JSON.parse(event.target.value) as [string, string]
                  void perform(() => window.api.setModel(provider, id))
                }}
              >
                {!modelKey && <NativeSelectOption value="">选择模型</NativeSelectOption>}
                {snapshot?.model &&
                  !snapshot.models.some(
                    (model) =>
                      model.provider === snapshot.model?.provider && model.id === snapshot.model.id
                  ) && (
                    <NativeSelectOption value={modelKey}>
                      {snapshot.model.id}（不可用）
                    </NativeSelectOption>
                  )}
                {snapshot?.models.map((model) => (
                  <NativeSelectOption
                    key={JSON.stringify([model.provider, model.id])}
                    value={JSON.stringify([model.provider, model.id])}
                  >
                    {model.id} · {model.provider}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              {snapshot?.running ? (
                <InputGroupButton
                  variant="secondary"
                  size="icon-sm"
                  aria-label="停止生成"
                  disabled={stopping}
                  onClick={() => void stop()}
                >
                  <SquareIcon />
                </InputGroupButton>
              ) : (
                <InputGroupButton
                  type="submit"
                  variant="default"
                  size="icon-sm"
                  aria-label="发送消息"
                  disabled={!ready || busy || !hasModel || !draft.trim()}
                >
                  <ArrowUpIcon />
                </InputGroupButton>
              )}
            </InputGroupAddon>
          </InputGroup>
        </form>
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>使用本机 pi 配置</span>
          <span>Enter 发送 · Shift + Enter 换行</span>
        </div>
      </footer>
    </main>
  )
}

export default App
