import type { RefObject } from 'react'
import {
  ChevronDownIcon,
  CornerDownLeftIcon,
  FolderOpenIcon,
  FolderXIcon,
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
import { InputGroupAddon, InputGroupButton } from '@renderer/components/ui/input-group'
import { directoryName } from '@renderer/lib/pi-display'
import { ThinkingControl } from '@renderer/components/ThinkingControl'
import { ToolApprovalControl } from '@renderer/components/ToolApprovalControl'
import { ContextUsageIndicator } from '@renderer/components/ContextUsageIndicator'
import { SlashCommandInput } from '@renderer/components/SlashCommandInput'
import { Spinner } from '@renderer/components/ui/spinner'
import { canExecuteSlashCommand, matchSlashCommand } from '@renderer/lib/slash-commands'
import { useLanguage } from '@renderer/hooks/use-language'
import type { PiSnapshot, PiThinkingLevel } from '../../../shared/pi'
import type { ToolApprovalMode } from '../../../shared/tool-approval'

interface ChatComposerProps {
  snapshot: PiSnapshot | null
  hasMessages: boolean
  draft: string
  busy: boolean
  commandPending: boolean
  stopping: boolean
  textarea: RefObject<HTMLTextAreaElement | null>
  onDraft: (text: string) => void
  onSend: () => void
  onStop: () => void
  onChooseDirectory: () => void
  onOpenLogin: () => void
  onModel: (provider: string, id: string) => void
  onThinking: (level: PiThinkingLevel) => Promise<boolean>
  onApprovalMode: (mode: ToolApprovalMode) => void
}

export function ChatComposer({
  snapshot,
  hasMessages,
  draft,
  busy,
  commandPending,
  stopping,
  textarea,
  onDraft,
  onSend,
  onStop,
  onChooseDirectory,
  onOpenLogin,
  onModel,
  onThinking,
  onApprovalMode
}: ChatComposerProps): React.JSX.Element {
  const { t } = useLanguage()
  const ready = snapshot?.connection === 'ready'
  const command = matchSlashCommand(draft)
  const commandAvailable =
    !!command && canExecuteSlashCommand(command, { snapshot, busy, commandPending })
  const modelKey = snapshot?.model
    ? JSON.stringify([snapshot.model.provider, snapshot.model.id])
    : ''
  const hasModel = !!snapshot?.models.some(
    (model) => model.provider === snapshot.model?.provider && model.id === snapshot.model.id
  )

  if (snapshot?.unavailableWorkspaces.includes(snapshot.cwd)) {
    return (
      <footer className="mx-auto w-full max-w-4xl shrink-0 px-6 pb-4 pt-3 sm:px-8">
        <Alert>
          <FolderXIcon />
          <AlertTitle>{t('工作目录不可用')}</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <p>{t('工作目录文件夹已被移除或无法访问，当前会话仅可查看历史消息。')}</p>
            <p className="break-all">{snapshot.cwd}</p>
            <p>{t('恢复原路径下的文件夹后即可继续对话。')}</p>
            {snapshot.running && (
              <Button
                variant="outline"
                size="sm"
                className="self-start"
                disabled={stopping}
                onClick={onStop}
              >
                <SquareIcon data-icon="inline-start" />
                {t('停止生成')}
              </Button>
            )}
          </AlertDescription>
        </Alert>
      </footer>
    )
  }

  return (
    <footer className="mx-auto flex w-full max-w-4xl shrink-0 flex-col gap-2 px-6 pb-4 pt-3 sm:px-8">
      {snapshot &&
        [
          '正在整理上下文',
          '上下文压缩完成',
          '当前没有可压缩的历史内容，可继续对话',
          '当前上下文已压缩，暂无新的内容需要整理'
        ].includes(snapshot.activity) && (
          <span role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
            {snapshot.activity === '正在整理上下文' && <Spinner />}
            {t(snapshot.activity)}
          </span>
        )}
      {ready && !hasModel && (
        <Alert>
          <AlertTitle>{t('尚无可用模型')}</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <p>{t('登录账号或配置 API 密钥后即可开始对话。')}</p>
            <Button variant="outline" size="sm" className="self-start" onClick={onOpenLogin}>
              {t('登录')}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {!hasMessages && (
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
      )}
      <SlashCommandInput
        key={snapshot?.sessionKey}
        sessionKey={snapshot?.sessionKey}
        draft={draft}
        textarea={textarea}
        disabled={!snapshot?.session}
        onDraft={onDraft}
        onSend={onSend}
      >
        <InputGroupAddon align="inline-end" className="self-end px-2 py-2">
          {snapshot?.running && !command ? (
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
              disabled={
                !draft.trim() || (command ? !commandAvailable : !ready || busy || !hasModel)
              }
            >
              <CornerDownLeftIcon />
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </SlashCommandInput>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <ToolApprovalControl
          value={snapshot?.toolApprovalMode ?? 'request'}
          disabled={!snapshot}
          onChange={onApprovalMode}
        />
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
