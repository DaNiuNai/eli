import { useEffect, useId, useRef, useState } from 'react'
import { BookOpenIcon, RefreshCwIcon } from 'lucide-react'
import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import { Button } from '@renderer/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@renderer/components/ui/empty'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel
} from '@renderer/components/ui/field'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { Switch } from '@renderer/components/ui/switch'
import { useAutoSave } from '@renderer/hooks/use-auto-save'
import { useLanguage } from '@renderer/hooks/use-language'
import type { UserSkill } from '../../../shared/skills'

export function SkillsSettingsPanel(): React.JSX.Element {
  const { t } = useLanguage()
  const id = useId()
  const [skills, setSkills] = useState<UserSkill[] | null>(null)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const active = useRef(true)
  const save = useAutoSave<boolean>(async (filePath, enabled) => {
    const result = await window.api.setSkillEnabled(filePath, enabled)
    if (active.current) setSkills(result)
  }, 'skills')

  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])

  useEffect(() => {
    let current = true
    void window.api.getUserSkills().then(
      (result) => {
        if (current) {
          setSkills(result)
          setError('')
        }
      },
      (cause: unknown) => {
        if (current) setError(cause instanceof Error ? cause.message : String(cause))
      }
    )
    return () => {
      current = false
    }
  }, [reload])

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-sm font-semibold">{t('用户级 Skill')}</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            await save.flush()
            setReload((value) => value + 1)
          }}
        >
          <RefreshCwIcon data-icon="inline-start" />
          {t('重新加载')}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        {t(
          '关闭后将不再向模型提供该用户级 Skill，也不会出现在技能命令中。项目级同名 Skill 保持可用。'
        )}
      </p>
      <p className="text-sm text-muted-foreground">
        {t('修改自动保存，并在下一次会话操作时生效。')}
      </p>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{t(error)}</AlertDescription>
        </Alert>
      )}
      {!skills && !error ? (
        <div role="status" aria-label={t('正在加载技能…')} className="flex flex-col gap-4 py-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-full" />
        </div>
      ) : skills && !skills.length ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BookOpenIcon />
            </EmptyMedia>
            <EmptyTitle>{t('暂无用户级 Skill')}</EmptyTitle>
            <EmptyDescription>
              {t('在 ~/.eli/skills、~/.agents/skills 或设置的技能路径中添加 Skill 后重新加载。')}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <FieldGroup className="gap-0">
          {(skills ?? []).map((skill, index) => {
            const state = save.states[skill.filePath]
            const enabled = state && state.status !== 'saved' ? state.value : skill.enabled
            const controlId = `${id}-${index}`
            return (
              <Field
                key={skill.filePath}
                orientation="horizontal"
                className="settings-row"
                data-invalid={state?.status === 'error'}
              >
                <FieldContent className="min-w-0">
                  <FieldLabel htmlFor={controlId}>{skill.name}</FieldLabel>
                  <FieldDescription id={`${controlId}-description`}>
                    {skill.description}
                  </FieldDescription>
                  <p className="break-all text-xs text-muted-foreground">{skill.filePath}</p>
                </FieldContent>
                <Switch
                  id={controlId}
                  checked={enabled}
                  aria-describedby={`${controlId}-description`}
                  aria-invalid={state?.status === 'error'}
                  onCheckedChange={(checked) => save.update(skill.filePath, checked, 0)}
                />
              </Field>
            )
          })}
        </FieldGroup>
      )}
    </section>
  )
}
