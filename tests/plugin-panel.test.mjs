import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import electron from 'electron'

test('Electron 聊天页直接装载和热卸载 dsh 双端组合包，并保留活跃会话', async () => {
  const temp = resolve('.tmp')
  await mkdir(temp, { recursive: true })
  const root = await mkdtemp(join(temp, 'plugin-panel-'))
  try {
    const result = await promisify(execFile)(
      electron,
      [
        resolve('tests/plugin-panel-electron.cjs'),
        root,
        resolve(process.env.ELI_TEST_APP_ASAR || '.')
      ],
      {
        windowsHide: true,
        timeout: 65000,
        cwd: root,
        env: { ...process.env, USERPROFILE: root, HOME: root, APPDATA: root, LOCALAPPDATA: root }
      }
    )
    assert.match(result.stdout, /dual-half bundle hot-loaded/)
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 })
  }
})
