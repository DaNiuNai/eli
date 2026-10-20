import type { PiApi } from '../shared/pi'

declare global {
  interface Window {
    api: PiApi
  }
}
