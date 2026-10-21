import type { RefObject } from 'react'
import {
  ChevronDownIcon,
  CornerDownLeftIcon,
  FolderOpenIcon,
  LaptopIcon,
  SquareIcon
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@renderer/components/ui/alert'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea
} from '@renderer/components/ui/input-group'
import { directoryName } from '@renderer/lib/pi-display'
import { ThinkingControl } from '@renderer/components/ThinkingControl'
import { ContextUsageIndicator } from '@renderer/components/ContextUsageIndicator'
import { useLanguage } from '@renderer/hooks/use-language'
import type { PiSnapshot, PiThinkingLevel } from '../../../shared/pi'

interface ChatComposerProps {
  snapshot: PiSnapshot | null
  draft: string
  busy: boolean
  stopping: boolean
  textarea: RefObject<HTMLTextAreaElement | null>
  onDraft: (text: string) => void
  onSend: () => void
  onStop: () => void
  onChooseDirectory: () => void
  onModel: (provider: string, id: string) => void
  onThinking: (level: PiThinkingLevel) => Promise<boolean>
}

export function ChatComposer({
  snapshot,
  draft,
  busy,
  stopping,
  textarea,
  onDraft,
  onSend,
  onStop,
  onChooseDirectory,
  onModel,
  onThinking
}: ChatComposerProps): React.JSX.Element {
  const { t } = useLanguage()
  const ready = snapshot?.connection === 'ready'
  const modelKey = snapshot?.model
    ? JSON.stringify([snapshot.model.provider, snapshot.model.id])
    : ''
  const hasModel = !!snapshot?.models.some(
    (model) => model.provider === snapshot.model?.provider && model.id === snapshot.model.id
  )

  return (
    <footer className="mx-auto flex w-full max-w-4xl shrink-0 flex-col gap-2 px-6 pb-4 pt-3 sm:px-8">
      {ready && !hasModel && (
        <Alert>
          <AlertTitle>{t('尚无可用模型')}</AlertTitle>
          <AlertDescription>
            {t('请先在本机登录或配置模型，再点击侧栏底部的重新连接。')}
          </AlertDescription>
        </Alert>
      )}
      <div className="flex min-w-0 items-center gap-2">
        <Badge variant="secondary" className="h-7 gap-1.5 rounded-md">
          <LaptopIcon />
          <span>{t('本机')}</span>
        </Badge>
        <Button
          variant="secondary"
          size="sm"
          className="min-w-0 max-w-[75%]"
          disabled={busy || !ready}
          title={snapshot?.cwd || t('选择工作目录')}
          onClick={onChooseDirectory}
        >
          <FolderOpenIcon data-icon="inline-start" />
          <span className="truncate">{directoryName(snapshot?.cwd ?? '', t('工作目录'))}</span>
          <ChevronDownIcon data-icon="inline-end" />
        </Button>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          onSend()
        }}
      >
        <InputGroup className="rounded-2xl">
          <InputGroupTextarea
            ref={textarea}
            aria-label={t('消息')}
            placeholder={t('描述一个任务，或者问个问题…')}
            className="max-h-40 min-h-12 px-4 py-3"
            disabled={!snapshot?.session}
            value={draft}
            maxLength={100000}
            onChange={(event) => onDraft(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing &&
                event.keyCode !== 229
              ) {
                event.preventDefault()
                onSend()
              }
            }}
          />
          <InputGroupAddon align="inline-end" className="self-end px-2 py-2">
            {snapshot?.running ? (
              <InputGroupButton
                variant="ghost"
                size="icon-sm"
                className="composer-action-button"
                aria-label={t('停止生成')}
                title={t('停止生成')}
                disabled={stopping}
                onClick={onStop}
              >
                <SquareIcon />
              </InputGroupButton>
            ) : (
              <InputGroupButton
                type="submit"
                variant="ghost"
                size="icon-sm"
                className="composer-action-button"
                aria-label={t('发送消息')}
                title={t('发送消息')}
                disabled={!ready || busy || !hasModel || !draft.trim()}
              >
                <CornerDownLeftIcon />
              </InputGroupButton>
            )}
          </InputGroupAddon>
        </InputGroup>
      </form>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="text-xs text-muted-foreground">
          {t('Enter 发送 · Shift + Enter 换行')}
        </span>
        <div className="ml-auto flex min-w-0 max-w-full items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="sm" className="min-w-0 max-w-64" />}
              aria-label={t('选择模型')}
              disabled={!ready || busy || !snapshot?.models.length}
            >
              <span className="truncate">{snapshot?.model?.id || t('选择模型')}</span>
              <ChevronDownIcon data-icon="inline-end" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" className="max-h-80 w-80">
              <DropdownMenuRadioGroup
                value={modelKey}
                onValueChange={(value) => {
                  const model = snapshot?.models.find(
                    (entry) => JSON.stringify([entry.provider, entry.id]) === value
                  )
                  if (model) onModel(model.provider, model.id)
                }}
              >
                {snapshot?.models.map((model) => (
                  <DropdownMenuRadioItem
                    key={JSON.stringify([model.provider, model.id])}
                    value={JSON.stringify([model.provider, model.id])}
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate">{model.id}</span>
                      <span className="text-xs text-muted-foreground">{model.provider}</span>
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {snapshot?.session && snapshot.thinkingLevels.length > 1 && (
            <ThinkingControl
              key={modelKey}
              levels={snapshot.thinkingLevels}
              value={snapshot.session.thinkingLevel}
              disabled={!ready || busy}
              onChange={onThinking}
            />
          )}
          <ContextUsageIndicator
            usage={snapshot?.contextUsage ?? null}
            contextWindow={snapshot?.model?.contextWindow}
          />
        </div>
      </div>
    </footer>
  )
}
