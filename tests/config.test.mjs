import test from 'node:test'
import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { EliConfigStore } from '../src/config/store.ts'
import { AppConfig } from '../src/main/app-config.ts'
import { AgentSettingsService } from '../src/runtime/settings-service.ts'
import { createSettings } from '../src/runtime/settings.ts'
import { ProvidersService } from '../src/runtime/providers.ts'
import { closeNetwork } from '../src/runtime/network.ts'
import { tasksPanelSizing } from '../src/shared/app-preferences.ts'

async function fixture(t) {
  const temporary = resolve('.tmp')
  await mkdir(temporary, { recursive: true })
  const root = await mkdtemp(join(temporary, 'config-test-'))
  t.after(async () => {
    await closeNetwork()
    assert.ok(root.startsWith(temporary + '\\') || root.startsWith(temporary + '/'))
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  return { root, path: join(root, 'config.json') }
}

test('Eli 配置集中保存，旧 SDK 配置不加载、不迁移、不修改', async (t) => {
  const { root, path } = await fixture(t)
  const legacy = ['settings.json', 'models.json', 'providers.json', 'auth.json']
  for (const name of legacy) await writeFile(join(root, name), `{ invalid legacy ${name}`)
  const app = new AppConfig(path)
  await app.load()
  assert.equal(app.firstLaunch, true)
  const settings = new AgentSettingsService(root)
  await settings.save([{ key: 'defaultThinkingLevel', value: 'high' }])
  const providers = new ProvidersService(root, () => {})
  await providers.change({
    action: 'create',
    id: 'config-only',
    name: 'Config only',
    api: 'openai-completions',
    baseUrl: 'http://127.0.0.1:9/v1'
  })
  await providers.change({ action: 'saveKey', id: 'config-only', key: 'test-config-secret' })
  await app.set({ ...app.get(), theme: 'dark' })
  const saved = await new EliConfigStore(path).read()
  assert.equal(saved.app.theme, 'dark')
  assert.equal(saved.agent.defaultThinkingLevel, 'high')
  assert.equal(saved.providers['config-only'].name, 'Config only')
  assert.equal(saved.credentials['api_key:config-only'].key, 'test-config-secret')
  assert.equal(JSON.stringify(app.get()).includes('test-config-secret'), false)
  assert.equal(JSON.stringify(await settings.get()).includes('test-config-secret'), false)
  await new EliConfigStore(path).update((config) => {
    config.deviceId = 'test-stable-device-id'
  })
  const before = await readFile(path, 'utf8')
  const memory = await createSettings(root)
  assert.equal(memory.getDefaultThinkingLevel(), 'high')
  assert.equal(memory.getOrCreateDeviceId(), 'test-stable-device-id')
  memory.setDefaultThinkingLevel('low')
  await memory.flush()
  assert.equal(await readFile(path, 'utf8'), before)
  await providers.change({ action: 'delete', id: 'config-only' })
  for (const name of legacy)
    assert.equal(await readFile(join(root, name), 'utf8'), `{ invalid legacy ${name}`)
})

test('自定义说明文件通过设置保存、校验和重置，保留其他配置并检测并发修改', async (t) => {
  const { root, path } = await fixture(t)
  const store = new EliConfigStore(path)
  await store.update((config) => {
    config.app.theme = 'dark'
    config.agent.defaultThinkingLevel = 'high'
    config.credentials['api_key:fixture'] = { type: 'api_key', key: 'instruction-test-only' }
  })
  const service = new AgentSettingsService(root)
  assert.equal((await service.get()).values.agentsFiles, undefined)
  const paths = ['rules/AGENTS.md', '~/team.md', join(root, 'absolute rules.md')]
  const saved = await service.save([{ key: 'agentsFiles', value: paths }])
  assert.deepEqual(saved.values.agentsFiles, paths)
  assert.deepEqual((await store.read()).agent.agentsFiles, paths)
  const before = await readFile(path, 'utf8')
  for (const value of ['rules.md', {}, [42], [null], [''], ['  ']]) {
    await assert.rejects(
      service.save([{ key: 'agentsFiles', value, expected: paths }]),
      /自定义说明文件/
    )
    assert.equal(await readFile(path, 'utf8'), before)
  }
  await assert.rejects(service.save([{ key: 'agentsFiles', value: [] }]), /设置已被其他操作修改/)
  assert.equal(await readFile(path, 'utf8'), before)
  assert.deepEqual(
    (await service.save([{ key: 'agentsFiles', value: [], expected: paths }])).values.agentsFiles,
    []
  )
  const reset = await service.save([{ key: 'agentsFiles', reset: true, expected: [] }])
  assert.equal(reset.values.agentsFiles, undefined)
  const config = await store.read()
  assert.equal(Object.hasOwn(config.agent, 'agentsFiles'), false)
  assert.equal(config.app.theme, 'dark')
  assert.equal(config.agent.defaultThinkingLevel, 'high')
  assert.equal(config.credentials['api_key:fixture'].key, 'instruction-test-only')
  for (const agentsFiles of ['rules.md', [false], ['']]) {
    await writeFile(path, JSON.stringify({ agent: { agentsFiles } }))
    await assert.rejects(service.get(), /无法读取 Eli 配置/)
  }
})

test('多进程更新配置与主进程保存偏好互不覆盖', async (t) => {
  const { root, path } = await fixture(t)
  const app = new AppConfig(path)
  await app.load()
  const writer = join(root, 'writer.mjs')
  const storeUrl = pathToFileURL(resolve('src/config/store.ts')).href
  await writeFile(
    writer,
    `import { EliConfigStore } from ${JSON.stringify(storeUrl)}
    const store = new EliConfigStore(process.argv[2])
    for (let index = 0; index < 5; index++) {
      await store.update(async (config) => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        config.providers[process.argv[3]] = { name: String(index) }
      })
    }`
  )
  const register = new URL('../scripts/register-typescript.mjs', import.meta.url).href
  const workers = Array.from({ length: 4 }, (_, index) => {
    const child = fork(writer, [path, `worker-${index}`], {
      execArgv: ['--experimental-transform-types', '--import', register],
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      windowsHide: true
    })
    t.after(() => {
      if (child.exitCode === null) child.kill()
    })
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    return new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code) => {
        if (code === 0) resolve()
        else reject(new Error(stderr || `Config writer exited: ${code}`))
      })
    })
  })
  await Promise.all([
    ...workers,
    app.set({ ...app.get(), language: 'en' }),
    new EliConfigStore(path).update(({ credentials }) => {
      credentials['api_key:local'] = { type: 'api_key', key: 'local-concurrent-secret' }
    })
  ])
  const saved = await new EliConfigStore(path).read()
  assert.equal(saved.app.language, 'en')
  assert.equal(saved.credentials['api_key:local'].key, 'local-concurrent-secret')
  for (let index = 0; index < 4; index++) assert.equal(saved.providers[`worker-${index}`].name, '4')
  assert.deepEqual((await readdir(root)).sort(), ['config.json', 'writer.mjs'])
})

test('配置更新失败时保留原文件，读取错误不泄露凭据', async (t) => {
  const { path } = await fixture(t)
  const store = new EliConfigStore(path)
  await store.update(({ credentials }) => {
    credentials['api_key:local'] = { type: 'api_key', key: 'test-private-value' }
  })
  const before = await readFile(path, 'utf8')
  await assert.rejects(
    store.update((config) => {
      config.app.theme = 'dark'
      throw new Error('cancel update')
    }),
    /cancel update/
  )
  assert.equal(await readFile(path, 'utf8'), before)
  await writeFile(path, '{ "test-private-value": ')
  await assert.rejects(store.read(), (error) => {
    assert.equal(error.message.includes('test-private-value'), false)
    return true
  })
})

test('旧版顶层应用偏好不自动迁移到新配置', async (t) => {
  const { path } = await fixture(t)
  await writeFile(path, JSON.stringify({ theme: 'dark', language: 'en' }))
  const app = new AppConfig(path)
  await app.load()
  assert.equal(app.get().theme, 'system')
  assert.equal(app.get().language, 'zh-CN')
  await app.set({ ...app.get(), theme: 'light' })
  const saved = JSON.parse(await readFile(path, 'utf8'))
  assert.equal(saved.version, 1)
  assert.equal(saved.app.theme, 'light')
  assert.equal(Object.hasOwn(saved, 'theme'), false)
})

test('已有布局补全任务面板宽度，保存后可恢复并拒绝非法宽度', async (t) => {
  const { path } = await fixture(t)
  await writeFile(path, JSON.stringify({ version: 1, app: { sidebarWidth: 320 } }))
  const app = new AppConfig(path)
  await app.load()
  assert.equal(app.get().sidebarWidth, 320)
  assert.equal(app.get().tasksPanelWidth, tasksPanelSizing.defaultWidth)

  for (const tasksPanelWidth of [tasksPanelSizing.minWidth, 360, tasksPanelSizing.maxWidth]) {
    await app.set({ ...app.get(), tasksPanelWidth })
    const restored = new AppConfig(path)
    await restored.load()
    assert.equal(restored.get().tasksPanelWidth, tasksPanelWidth)
    assert.equal(restored.get().sidebarWidth, 320)
  }

  const before = await readFile(path, 'utf8')
  for (const tasksPanelWidth of [199, 481, NaN, Infinity, null, '320']) {
    assert.throws(() => app.set({ ...app.get(), tasksPanelWidth }), /无效的任务面板宽度设置/)
    assert.equal(await readFile(path, 'utf8'), before)
  }
})
