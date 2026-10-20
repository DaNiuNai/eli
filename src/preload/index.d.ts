import type { PiApi } from '../shared/pi'
import type { WindowAppearanceApi } from '../shared/window-appearance'

declare global {
  interface Window {
    api: PiApi
    windowAppearance?: WindowAppearanceApi
  }
}
