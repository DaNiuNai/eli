import type { ReactNode } from 'react'
import type { SettingsPageProps } from './contracts'
import { PluginSlot } from './slots'
import { DshSlot } from './dsh-slots'
import { ProviderSettingsPanel } from '../components/ProviderSettingsPanel'
import { SkillsSettingsPanel } from '../components/SkillsSettingsPanel'
import { McpSettingsPanel } from '../components/McpSettingsPanel'
import { UsageSettingsPanel } from '../components/UsageSettingsPanel'
import { AboutSettings } from '../components/AboutSettings'
import { PluginsPanel } from '../components/PluginsPanel'

function ScrollPage({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">{children}</div>
}
export function GeneralPage(): React.JSX.Element {
  return (
    <ScrollPage>
      <PluginSlot name="settings.general" />
      <DshSlot name="settings.general.item" />
    </ScrollPage>
  )
}
export function ProvidersPage({ login }: SettingsPageProps): React.JSX.Element {
  return <ProviderSettingsPanel auth={login} />
}
export function SkillsPage({ close }: SettingsPageProps): React.JSX.Element {
  return (
    <ScrollPage>
      <SkillsSettingsPanel onSessionStarted={close} />
    </ScrollPage>
  )
}
export function McpPage(): React.JSX.Element {
  return (
    <ScrollPage>
      <McpSettingsPanel />
    </ScrollPage>
  )
}
export function UsagePage({ usage }: SettingsPageProps): React.JSX.Element {
  return (
    <ScrollPage>
      <UsageSettingsPanel {...usage} />
    </ScrollPage>
  )
}
export function AboutPage(): React.JSX.Element {
  return (
    <ScrollPage>
      <AboutSettings />
    </ScrollPage>
  )
}
export function PluginsPage(): React.JSX.Element {
  return (
    <ScrollPage>
      <PluginsPanel />
    </ScrollPage>
  )
}
