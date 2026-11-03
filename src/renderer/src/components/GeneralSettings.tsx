import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from './ui/field'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'
import { useLanguage } from '../hooks/use-language'
import { isTheme, useTheme } from '../hooks/use-theme'
import { DefaultWorkspaceSettings } from './DefaultWorkspaceSettings'
import { TerminalSettings } from './TerminalSettings'
import { AutoApprovalSettings } from './AutoApprovalSettings'

const themeOptions = [
  { value: 'light', label: '亮色' },
  { value: 'dark', label: '暗色' },
  { value: 'system', label: '跟随系统' }
]

export function GeneralSettings(): React.JSX.Element {
  const { t } = useLanguage()
  const { theme, setTheme } = useTheme()
  return (
    <FieldGroup className="gap-0">
      <section className="flex flex-col gap-6">
        <FieldGroup className="gap-0">
          <Field orientation="responsive" className="settings-row">
            <FieldContent>
              <FieldLabel id="settings-theme-label">{t('外观')}</FieldLabel>
              <FieldDescription>{t('选择 eli 的界面主题。')}</FieldDescription>
            </FieldContent>
            <ToggleGroup
              value={[theme]}
              onValueChange={(values) => isTheme(values[0]) && setTheme(values[0])}
              aria-labelledby="settings-theme-label"
              variant="outline"
              size="sm"
              spacing={0}
            >
              {themeOptions.map(({ value, label }) => (
                <ToggleGroupItem key={value} value={value}>
                  {t(label)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>
        </FieldGroup>
      </section>
      <DefaultWorkspaceSettings />
      <section className="flex flex-col gap-6">
        <TerminalSettings />
      </section>
      <AutoApprovalSettings />
    </FieldGroup>
  )
}
