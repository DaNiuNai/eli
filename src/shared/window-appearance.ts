export interface WindowAppearanceApi {
  customTitleBar: boolean
  setDarkMode(dark: boolean): Promise<void>
}

export const windowAppearanceChannel = 'window:set-dark-mode'
