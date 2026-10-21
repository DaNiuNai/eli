import type { PiApi } from '../shared/pi'
import type { WindowAppearanceApi } from '../shared/window-appearance'
import type { AppPreferencesApi } from '../shared/app-preferences'

declare global {
  interface Window {
    api: PiApi
    appPreferences: AppPreferencesApi
    windowAppearance?: WindowAppearanceApi
  }
}
