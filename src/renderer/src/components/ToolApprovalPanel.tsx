import { useRef, useState } from 'react'
import { CheckIcon, ShieldQuestionIcon, XIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@renderer/components/ui/alert'
import { Button } from '@renderer/components/ui/button'
import { Spinner } from '@renderer/components/ui/spinner'
import { useLanguage } from '@renderer/hooks/use-language'
import type { AutoApprovalState, ToolApprovalRequest } from '../../../shared/tool-approval'

export function ToolApprovalPanel({
  requests,
  autoApproval,
  disabled,
  onRespond
}: {
  requests: ToolApprovalRequest[]
  autoApproval?: AutoApprovalState
  disabled: boolean
  onRespond: (id: string, approved: boolean) => Promise<boolean>
}): React.JSX.Element | null {
  const { t } = useLanguage()
  const [responding, setResponding] = useState<Set<string>>(new Set())
  const respondingRef = useRef(new Set<string>())

  async function respond(id: string, approved: boolean): Promise<void> {
    if (disabled || respondingRef.current.has(id)) return
    respondingRef.current.add(id)
    setResponding(new Set(respondingRef.current))
    try {
      await onRespond(id, approved)
    } finally {
      respondingRef.current.delete(id)
      setResponding(new Set(respondingRef.current))
    }
  }

  if (!requests.length && !autoApproval?.paused) return null
  return (
    <section
      aria-label={t('等待工具审批')}
      className="mx-auto flex max-h-[40dvh] w-full max-w-4xl shrink-0 flex-col gap-2 overflow-auto px-6 pt-3 sm:px-8"
    >
      {autoApproval?.paused && (
        <Alert>
          <ShieldQuestionIcon />
          <AlertTitle>{t('自动批准已暂停')}</AlertTitle>
          <AlertDescription>
            {t(
              '连续 3 次自动拒绝，当前会话已转为人工审批。切换到其他挡位后重新开启自动批准可恢复。'
            )}
          </AlertDescription>
        </Alert>
      )}
      {requests.map((request) => (
        <Alert key={request.id}>
          <ShieldQuestionIcon />
          <AlertTitle>
            {t('等待工具审批')} · {request.toolName}
          </AlertTitle>
          <AlertDescription className="flex min-w-0 flex-col gap-3">
            <span>{t('此工具尚未执行，请检查参数后选择是否放行。')}</span>
            {request.reason && <span>{t(request.reason)}</span>}
            {request.parentToolCallId && <span>{t('由其他工具发起的嵌套调用')}</span>}
            <pre className="max-h-48 w-full overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap break-all text-foreground">
              {JSON.stringify(request.input, null, 2)}
            </pre>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={disabled || responding.has(request.id)}
                onClick={() => void respond(request.id, false)}
              >
                <XIcon data-icon="inline-start" />
                {t('拒绝')}
              </Button>
              <Button
                size="sm"
                disabled={disabled || responding.has(request.id)}
                onClick={() => void respond(request.id, true)}
              >
                {responding.has(request.id) ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <CheckIcon data-icon="inline-start" />
                )}
                {t('允许本次')}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ))}
    </section>
  )
}
