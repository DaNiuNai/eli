import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'

export function resourcePath(base: string, path: string): string {
  const expanded = path.replace(/^~(?=$|[\\/])/, homedir())
  return isAbsolute(expanded) ? expanded : resolve(base, expanded)
}
