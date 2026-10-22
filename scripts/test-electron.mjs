import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import electron from 'electron'

const workspace = fileURLToPath(new URL('../', import.meta.url))
const temporary = join(workspace, '.tmp')
await mkdir(temporary, { recursive: true })
const directory = await mkdtemp(join(temporary, 'electron-runtime-'))
const entry = resolve(process.argv[2] || join(workspace, 'out/main/runtime.mjs'))
const child = spawn(electron, [join(workspace, 'tests/electron-runtime.cjs'), entry, directory], {
  stdio: 'inherit',
  windowsHide: true
})
const code = await new Promise((resolve, reject) => {
  child.once('error', reject)
  child.once('exit', resolve)
})
// 等到 Electron 自身也退出再清理，避免 Windows profile 和 cwd 句柄仍在使用。
if (!directory.startsWith(`${temporary}\\`) && !directory.startsWith(`${temporary}/`))
  throw new Error('无效的测试清理路径')
await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
process.exitCode = code ?? 1
