import { useState, type ReactNode, type RefObject } from 'react'
import { Command as CommandPrimitive } from 'cmdk'
import { SparklesIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@renderer/components/ui/alert'
import { Button } from '@renderer/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList
} from '@renderer/components/ui/command'
import { InputGroup, InputGroupTextarea } from '@renderer/components/ui/input-group'
import { Spinner } from '@renderer/components/ui/spinner'
import { useLanguage } from '@renderer/hooks/use-language'
import { usePiSkills } from '@renderer/hooks/use-pi-skills'
import {
  completeSkillCommand,
  filterSkillCommands,
  getSkillQuery
} from '@renderer/lib/skill-commands'

interface SkillCommandInputProps {
  sessionKey: string | undefined
  draft: string
  textarea: RefObject<HTMLTextAreaElement | null>
  disabled: boolean
  onDraft: (text: string) => void
  onSend: () => void
  children: ReactNode
}

export function SkillCommandInput({
  sessionKey,
  draft,
  textarea,
  disabled,
  onDraft,
  onSend,
  children
}: SkillCommandInputProps): React.JSX.Element {
  const { t } = useLanguage()
  const [focused, setFocused] = useState(false)
  const [selection, setSelection] = useState({ start: 0, end: 0 })
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [selected, setSelected] = useState('')
  const query = getSkillQuery(draft, selection.start, selection.end)
  const open = focused && !disabled && !!query && dismissed !== draft
  const { skills, loading, error, reload } = usePiSkills(sessionKey, open)
  const matches = filterSkillCommands(skills, query?.query ?? '')
  const selectedName = matches.some((skill) => skill.name === selected)
    ? selected
    : (matches[0]?.name ?? '')

  function complete(name: string): void {
    if (!query || !name) return
    const next = completeSkillCommand(draft, query.end, name)
    if (next.length > 100_000) return
    const caret = name.length + 2
    onDraft(next)
    setSelection({ start: caret, end: caret })
    requestAnimationFrame(() => {
      textarea.current?.focus()
      textarea.current?.setSelectionRange(caret, caret)
    })
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (open) complete(selectedName)
        else onSend()
      }}
    >
      <Command
        className="composer-skill-command"
        label={t('选择技能')}
        shouldFilter={false}
        value={selectedName}
        onValueChange={setSelected}
        loop
        vimBindings={false}
      >
        {open && (
          <CommandList
            className="composer-skill-menu absolute inset-x-0 bottom-full mb-2"
            label={t('可用技能')}
            onMouseDown={(event) => event.preventDefault()}
          >
            {loading ? (
              <div
                role="status"
                className="flex items-center gap-2 px-3 py-4 text-muted-foreground"
              >
                <Spinner />
                {t('正在加载技能…')}
              </div>
            ) : error ? (
              <Alert>
                <AlertTitle>{t('技能加载失败')}</AlertTitle>
                <AlertDescription className="flex flex-col gap-2">
                  <p className="max-h-20 overflow-auto whitespace-pre-wrap break-words">
                    {t(error)}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="self-start"
                    onClick={reload}
                  >
                    {t('重试')}
                  </Button>
                </AlertDescription>
              </Alert>
            ) : (
              <>
                <CommandEmpty>
                  {skills.length ? t('没有匹配的技能') : t('当前工作目录没有可用技能')}
                </CommandEmpty>
                <CommandGroup heading={t('技能')}>
                  {matches.map((skill) => (
                    <CommandItem
                      key={skill.name}
                      value={skill.name}
                      onSelect={() => complete(skill.name)}
                    >
                      <SparklesIcon />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate">/{skill.name}</span>
                        {skill.description && (
                          <span className="line-clamp-2 text-xs text-muted-foreground">
                            {skill.description}
                          </span>
                        )}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
            <p className="px-3 py-2 text-xs text-muted-foreground">
              {t('↑↓ 选择 · Tab / Enter 补全 · Esc 关闭')}
            </p>
          </CommandList>
        )}
        <InputGroup className="rounded-2xl">
          <CommandPrimitive.Input
            asChild
            value={draft}
            onValueChange={(text) => {
              setDismissed(null)
              onDraft(text)
            }}
          >
            <InputGroupTextarea
              ref={textarea}
              aria-label={t('消息')}
              aria-expanded={open}
              placeholder={t('描述一个任务，输入 / 选择技能…')}
              className="max-h-40 min-h-12 px-4 py-3"
              disabled={disabled}
              maxLength={100000}
              onChange={(event) =>
                setSelection({ start: event.target.selectionStart, end: event.target.selectionEnd })
              }
              onSelect={(event) =>
                setSelection({
                  start: event.currentTarget.selectionStart,
                  end: event.currentTarget.selectionEnd
                })
              }
              onFocus={() => {
                setFocused(true)
                setDismissed(null)
              }}
              onBlur={() => setFocused(false)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.keyCode === 229) {
                  event.stopPropagation()
                  return
                }
                if (open) {
                  if (
                    (event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
                    !event.shiftKey &&
                    !event.altKey &&
                    !event.ctrlKey &&
                    !event.metaKey
                  )
                    return
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    event.stopPropagation()
                    setDismissed(draft)
                    return
                  }
                  if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
                    event.preventDefault()
                    event.stopPropagation()
                    complete(selectedName)
                    return
                  }
                }
                // 关闭面板时让文本框保持原生的方向键、Home、End 与换行行为。
                event.stopPropagation()
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  onSend()
                }
              }}
            />
          </CommandPrimitive.Input>
          {children}
        </InputGroup>
      </Command>
    </form>
  )
}
