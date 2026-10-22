import { useCallback, useEffect, useState } from 'react'
import { ExternalLinkIcon, RefreshCwIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@renderer/components/ui/alert'
import { Button } from '@renderer/components/ui/button'
import { Spinner } from '@renderer/components/ui/spinner'
import { useLanguage } from '@renderer/hooks/use-language'
import type { AppUpdateSnapshot } from '../../../shared/app-updates'

export function AboutSettings(): React.JSX.Element {
  const { t } = useLanguage()
  const [snapshot, setSnapshot] = useState<AppUpdateSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [opening, setOpening] = useState(false)
  const receive = useCallback((next: AppUpdateSnapshot) => {
    setSnapshot((previous) => (previous && previous.revision > next.revision ? previous : next))
  }, [])

  useEffect(() => {
    let active = true
    const unsubscribe = window.appUpdates.onSnapshot((next) => active && receive(next))
    void window.appUpdates
      .get()
      .then((next) => active && receive(next))
      .catch(() => {
        if (active) setError('无法读取版本信息，请重试。')
      })
    return () => {
      active = false
      unsubscribe()
    }
  }, [receive])

  const check = async (): Promise<void> => {
    setPending(true)
    setError(null)
    try {
      receive(await window.appUpdates.check())
    } catch {
      setError('检查更新失败，请重试。')
    } finally {
      setPending(false)
    }
  }

  const openRelease = async (): Promise<void> => {
    setOpening(true)
    setError(null)
    try {
      await window.appUpdates.openRelease()
    } catch {
      setError('无法打开发行页，请重试。')
    } finally {
      setOpening(false)
    }
  }

  const checking = pending || snapshot?.status === 'checking'
  const message = error ?? snapshot?.error

  return (
    <section className="flex flex-col gap-6" aria-label={t('关于')}>
      <div className="flex flex-col gap-2">
        <h3 className="text-xl font-semibold">eli</h3>
        <p className="text-sm text-muted-foreground">{t('专注对话，从容完成任务。')}</p>
        <p className="text-sm text-muted-foreground">
          {t('当前版本：{version}', { version: snapshot?.currentVersion ?? '…' })}
        </p>
      </div>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h4 className="text-sm font-semibold">{t('软件更新')}</h4>
            <p className="text-sm text-muted-foreground">
              {t('检查新版本，并前往 GitHub 发行页下载安装包。')}
            </p>
          </div>
          <Button variant="outline" size="sm" disabled={checking || opening} onClick={check}>
            {checking ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <RefreshCwIcon data-icon="inline-start" />
            )}
            {checking ? t('正在检查…') : t('检查更新')}
          </Button>
        </div>
        <div role="status" aria-live="polite" aria-atomic="true">
          {checking && <p className="text-sm text-muted-foreground">{t('正在检查新版本…')}</p>}
          {!checking && snapshot?.status === 'up-to-date' && (
            <p className="text-sm text-muted-foreground">{t('当前已是最新版本。')}</p>
          )}
          {!checking && snapshot?.status === 'available' && (
            <Alert role="presentation">
              <AlertTitle>
                {t('发现新版本 {version}', { version: snapshot.latestVersion! })}
              </AlertTitle>
              <AlertDescription>
                {t('前往发行页查看更新说明，选择适合系统的安装包。')}
              </AlertDescription>
            </Alert>
          )}
        </div>
        {message && (
          <Alert variant="destructive">
            <AlertDescription>{t(message)}</AlertDescription>
          </Alert>
        )}
        {!checking && snapshot?.status === 'available' && (
          <Button className="self-start" size="sm" disabled={opening} onClick={openRelease}>
            {opening ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <ExternalLinkIcon data-icon="inline-start" />
            )}
            {t('前往下载')}
          </Button>
        )}
      </div>
    </section>
  )
}
