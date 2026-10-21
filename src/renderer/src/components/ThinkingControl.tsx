import { useId, useRef, useState } from 'react'
import { RotateCcwIcon } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger
} from '@renderer/components/ui/popover'
import { Slider } from '@renderer/components/ui/slider'
import { thinkingLabels } from '@renderer/lib/pi-display'
import { useLanguage } from '@renderer/hooks/use-language'
import type { PiThinkingLevel } from '../../../shared/pi'

export function ThinkingControl({
  levels,
  value,
  disabled,
  onChange
}: {
  levels: PiThinkingLevel[]
  value: PiThinkingLevel
  disabled: boolean
  onChange: (level: PiThinkingLevel) => Promise<boolean>
}): React.JSX.Element {
  const { t } = useLanguage()
  const labelId = useId()
  const descriptionId = useId()
  const [preview, setPreview] = useState<PiThinkingLevel | null>(null)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const selected = preview && levels.includes(preview) ? preview : value
  const index = Math.max(0, levels.indexOf(selected))
  const defaultLevel = levels.includes('medium') ? 'medium' : (levels[0] ?? value)
  const defaultIndex = levels.indexOf(defaultLevel)

  async function commit(next: number | readonly number[]): Promise<void> {
    const level = levels[typeof next === 'number' ? next : next[0]]
    if (!level || level === value || savingRef.current || disabled) return
    savingRef.current = true
    setSaving(true)
    try {
      if (!(await onChange(level))) setPreview(null)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <Popover onOpenChange={() => setPreview(null)}>
      <PopoverTrigger
        render={<Button variant="ghost" size="sm" />}
        aria-label={t('思考强度')}
        title={t('调整思考强度')}
        disabled={disabled || saving}
      >
        {t(thinkingLabels[value])}
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        className="w-56 max-w-[calc(100vw-2rem)] gap-2.5 rounded-xl p-2.5"
      >
        <PopoverHeader className="flex-row items-center justify-between gap-3">
          <PopoverTitle id={labelId} className="text-xs">
            <span className="text-muted-foreground">{t('思考强度')}</span>
            <span className="ml-2">{t(thinkingLabels[selected])}</span>
          </PopoverTitle>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t('恢复默认思考强度')}
            title={t('恢复默认：{level}', { level: t(thinkingLabels[defaultLevel]) })}
            disabled={disabled || saving || value === defaultLevel || defaultIndex < 0}
            onClick={() => {
              setPreview(defaultLevel)
              void commit(defaultIndex)
            }}
          >
            <RotateCcwIcon />
          </Button>
        </PopoverHeader>
        <div className="flex flex-col gap-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{t('更快')}</span>
            <span>{t('更深入')}</span>
          </div>
          <div className="thinking-slider">
            <div className="thinking-slider-marks" aria-hidden="true">
              {levels.map((level, position) => (
                <span
                  key={level}
                  className="thinking-slider-mark"
                  data-default={level === defaultLevel || undefined}
                  style={{ left: `${(position / Math.max(1, levels.length - 1)) * 100}%` }}
                />
              ))}
            </div>
            <Slider
              aria-labelledby={labelId}
              aria-describedby={descriptionId}
              min={0}
              max={Math.max(1, levels.length - 1)}
              step={1}
              value={[index]}
              disabled={disabled || saving || levels.length < 2}
              onValueChange={(next) => {
                const level = levels[typeof next === 'number' ? next : next[0]]
                if (level) setPreview(level)
              }}
              onValueCommitted={(next) => void commit(next)}
            />
          </div>
        </div>
        <PopoverDescription id={descriptionId} className="text-center text-xs">
          {saving ? t('正在应用…') : t('默认：{level}', { level: t(thinkingLabels[defaultLevel]) })}
        </PopoverDescription>
      </PopoverContent>
    </Popover>
  )
}
