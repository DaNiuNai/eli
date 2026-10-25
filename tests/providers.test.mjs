import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createServer } from 'node:http'
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai'
import { createEliModels, isolateProviderAuth } from '../src/runtime/models.ts'
import { ProvidersService } from '../src/runtime/providers.ts'
import { AgentAuthService } from '../src/runtime/auth.ts'
import { closeNetwork } from '../src/runtime/network.ts'
import { EliConfigStore } from '../src/config/store.ts'

async function fixture(t) {
  const temporary = resolve('.tmp')
  await mkdir(temporary, { recursive: true })
  const root = await mkdtemp(join(temporary, 'providers-test-'))
  t.after(async () => {
    await closeNetwork()
    assert.ok(root.startsWith(temporary + '\\') || root.startsWith(temporary + '/'))
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  return root
}
function mockProvider(onRefresh = () => {}) {
  return {
    id: 'mock-dual',
    name: 'Mock dual',
    baseUrl: 'http://127.0.0.1/v1',
    getModels: () => [
      {
        id: 'model',
        name: 'Model',
        provider: 'mock-dual',
        api: 'openai-completions',
        baseUrl: 'http://127.0.0.1/v1',
        reasoning: false,
        input: ['text'],
        contextWindow: 8192,
        maxTokens: 1024,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
      }
    ],
    stream() {
      throw new Error('No real model calls in auth tests')
    },
    streamSimple() {
      throw new Error('No real model calls in auth tests')
    },
    auth: {
      apiKey: {
        name: 'Mock API key',
        login: async (interaction) => ({
          type: 'api_key',
          key: await interaction.prompt({ type: 'secret', message: 'Key' })
        }),
        resolve: async ({ credential, ctx }) => {
          const key = credential?.key ?? (await ctx.env('MOCK_AMBIENT_KEY'))
          return key ? { auth: { apiKey: key } } : undefined
        }
      },
      oauth: {
        name: 'Mock subscription',
        isSubscription: true,
        login: async (interaction) => {
          await interaction.prompt({ type: 'manual_code', message: 'Code' })
          return {
            type: 'oauth',
            access: 'test-access',
            refresh: 'test-refresh',
            expires: Date.now() + 3600000
          }
        },
        refresh: async (credential) => {
          onRefresh()
          return { ...credential, access: 'test-refreshed', expires: Date.now() + 3600000 }
        },
        toAuth: async (credential) => ({ apiKey: credential.access })
      }
    }
  }
}

test('认证解析只接受显式凭据，不读取环境变量或外部凭据文件', async (t) => {
  const root = await fixture(t)
  const { runtime } = await createEliModels(root)
  assert.equal(runtime.hasConfiguredAuth('deepseek'), false)
  assert.equal(runtime.hasConfiguredAuth('openai'), false)
  assert.deepEqual(await runtime.getAvailable(), [])
  assert.equal(await runtime.getAuth('deepseek'), undefined)
  assert.equal(await runtime.getAuth('openai'), undefined)
  let ambientReads = 0
  const provider = mockProvider()
  isolateProviderAuth(provider)
  const ctx = {
    env: async () => {
      ambientReads++
      return 'ambient-not-allowed'
    },
    fileExists: async () => {
      ambientReads++
      return true
    }
  }
  assert.equal(
    await provider.auth.apiKey.resolve({ ctx, signal: new AbortController().signal }),
    undefined
  )
  assert.equal(
    await provider.auth.apiKey.resolve({
      ctx,
      credential: { type: 'api_key' },
      signal: new AbortController().signal
    }),
    undefined
  )
  assert.equal(ambientReads, 0)
})

test('API Key 与 OAuth 独立保存、独立退出，SDK 自动刷新只更新 OAuth 槽', async (t) => {
  const root = await fixture(t)
  const api = await createEliModels(root, 'api_key')
  api.runtime.registerNativeProvider(mockProvider())
  await api.credentials.modify('mock-dual', async () => ({
    type: 'api_key',
    key: '${LITERAL_KEY_NOT_ENV}'
  }))
  assert.equal((await api.runtime.getAuth('mock-dual')).auth.apiKey, '${LITERAL_KEY_NOT_ENV}')
  const oauth = await createEliModels(root, 'oauth')
  let refreshes = 0
  oauth.runtime.registerNativeProvider(mockProvider(() => refreshes++))
  await oauth.credentials.modify('mock-dual', async () => ({
    type: 'oauth',
    access: 'old-access',
    refresh: 'old-refresh',
    expires: 1
  }))
  assert.equal((await oauth.runtime.getAuth('mock-dual')).auth.apiKey, 'test-refreshed')
  assert.equal(refreshes, 1)
  const saved = JSON.parse(await readFile(join(root, 'config.json'), 'utf8')).credentials
  assert.equal(saved['api_key:mock-dual'].key, '${LITERAL_KEY_NOT_ENV}')
  assert.equal(saved['oauth:mock-dual'].access, 'test-refreshed')
  await oauth.runtime.logout('mock-dual')
  assert.equal(await oauth.credentials.getStored('mock-dual', 'oauth'), undefined)
  assert.equal(
    (await api.credentials.getStored('mock-dual', 'api_key')).key,
    '${LITERAL_KEY_NOT_ENV}'
  )
  await api.runtime.logout('mock-dual')
  assert.equal(await api.runtime.getAuth('mock-dual'), undefined)
})

test('未配置时供应商表格为空，已有配置和凭据对应的供应商会保留', async (t) => {
  const root = await fixture(t)
  const service = new ProvidersService(root, () => {})
  const initial = await service.get()
  assert.ok(initial.providers.length > 0)
  assert.deepEqual(
    initial.providers.filter((provider) => provider.added),
    []
  )
  await service.change({ action: 'update', id: 'openai', enabled: false })
  const snapshot = await new ProvidersService(root, () => {}).get()
  const added = snapshot.providers.filter((provider) => provider.added)
  assert.deepEqual(
    added.map((provider) => provider.id),
    ['openai']
  )
  assert.equal(added[0].enabled, false)
  await service.change({ action: 'saveKey', id: 'anthropic', key: 'test-existing-key' })
  assert.equal(
    (await service.get()).providers.find((provider) => provider.id === 'anthropic').added,
    true
  )
})

test('主动添加内置供应商保留 SDK 模型和登录方式，重复添加不会覆盖配置', async (t) => {
  const root = await fixture(t)
  const service = new ProvidersService(root, () => {})
  const before = (await service.get()).providers.find((provider) => provider.id === 'openai')
  let snapshot = await service.change({ action: 'addBuiltin', id: before.id })
  const added = snapshot.providers.filter((provider) => provider.added)
  assert.deepEqual(
    added.map((provider) => provider.id),
    [before.id]
  )
  assert.equal(added[0].custom, false)
  assert.equal(added[0].apiKeySupported, before.apiKeySupported)
  assert.equal(added[0].oauthSupported, before.oauthSupported)
  assert.deepEqual(added[0].models, before.models)
  await service.change({ action: 'saveKey', id: before.id, key: 'test-built-in-key' })
  await service.change({
    action: 'update',
    id: before.id,
    name: 'My OpenAI',
    enabled: false,
    baseUrl: 'http://127.0.0.1:9/v1'
  })
  await service.change({ action: 'addBuiltin', id: before.id })
  snapshot = await new ProvidersService(root, () => {}).get()
  const retained = snapshot.providers.find((provider) => provider.id === before.id)
  assert.equal(retained.added, true)
  assert.equal(retained.apiKeyConfigured, true)
  assert.equal(retained.enabled, false)
  assert.equal(retained.name, 'My OpenAI')
  assert.equal(retained.baseUrl, 'http://127.0.0.1:9/v1')
  assert.equal(JSON.stringify(snapshot).includes('test-built-in-key'), false)
  const oauth = snapshot.providers.find(
    (provider) => !provider.apiKeySupported && provider.oauthSupported
  )
  assert.ok(oauth)
  snapshot = await service.change({ action: 'addBuiltin', id: oauth.id })
  const subscription = snapshot.providers.find((provider) => provider.id === oauth.id)
  assert.equal(subscription.added, true)
  assert.equal(subscription.authMode, 'oauth')
})

for (const custom of [false, true]) {
  test(`删除${custom ? '自定义' : '内置'}供应商会清除配置和两种凭据，之后可重新添加`, async (t) => {
    const root = await fixture(t)
    const service = new ProvidersService(root, () => {})
    const id = custom ? 'remove-custom' : 'openai'
    const create = custom
      ? {
          action: 'create',
          id,
          name: 'Remove custom',
          api: 'openai-completions',
          baseUrl: 'http://127.0.0.1:9/v1'
        }
      : { action: 'addBuiltin', id }
    await service.change(create)
    await service.change({ action: 'saveKey', id, key: 'test-remove-key' })
    await service.change({
      action: 'saveModel',
      id,
      model: {
        id: 'remove-model',
        name: 'Remove model',
        reasoning: false,
        vision: false,
        contextWindow: 8192,
        maxTokens: 1024
      }
    })
    await service.change({
      action: 'create',
      id: 'keep-provider',
      name: 'Keep provider',
      api: 'openai-completions',
      baseUrl: 'http://127.0.0.1:9/v1'
    })
    await service.change({ action: 'saveKey', id: 'keep-provider', key: 'test-keep-key' })
    const store = new EliConfigStore(join(root, 'config.json'))
    await store.update((config) => {
      config.credentials[`oauth:${id}`] = {
        type: 'oauth',
        access: 'test-remove-access',
        refresh: 'test-remove-refresh',
        expires: 1
      }
      config.app.theme = 'dark'
      config.agent.defaultThinkingLevel = 'high'
    })
    const snapshot = await service.change({ action: 'delete', id })
    assert.deepEqual(
      snapshot.providers.filter((provider) => provider.added).map((provider) => provider.id),
      ['keep-provider']
    )
    const saved = await store.read()
    assert.equal(saved.providers[id], undefined)
    assert.equal(saved.credentials[`api_key:${id}`], undefined)
    assert.equal(saved.credentials[`oauth:${id}`], undefined)
    assert.equal(saved.credentials['api_key:keep-provider'].key, 'test-keep-key')
    assert.equal(saved.providers['keep-provider'].name, 'Keep provider')
    assert.equal(saved.app.theme, 'dark')
    assert.equal(saved.agent.defaultThinkingLevel, 'high')
    const reloaded = (await new ProvidersService(root, () => {}).get()).providers.find(
      (provider) => provider.id === id
    )
    if (custom) assert.equal(reloaded, undefined)
    else {
      assert.equal(reloaded.added, false)
      assert.equal(reloaded.apiKeyConfigured, false)
      assert.equal(reloaded.oauthConfigured, false)
      assert.equal(
        reloaded.models.some((model) => model.id === 'remove-model'),
        false
      )
      assert.deepEqual(await (await service.models()).runtime.getAvailable(id), [])
    }
    const readded = (await service.change(create)).providers.find((provider) => provider.id === id)
    assert.equal(readded.added, true)
    assert.equal(readded.apiKeyConfigured, false)
    assert.equal(readded.oauthConfigured, false)
  })
}

test('自定义供应商不能伪装为内置供应商添加', async (t) => {
  const root = await fixture(t)
  const service = new ProvidersService(root, () => {})
  await service.change({
    action: 'create',
    id: 'my-custom',
    name: 'Custom',
    api: 'openai-completions',
    baseUrl: 'http://127.0.0.1:9/v1'
  })
  await assert.rejects(service.change({ action: 'addBuiltin', id: 'my-custom' }), /内置供应商/)
  await assert.rejects(
    service.change({ action: 'addBuiltin', id: 'missing-provider' }),
    /供应商不存在/
  )
})

test('供应商和模型管理持久化，密钥不进入界面快照，停用后不可用于请求', async (t) => {
  const root = await fixture(t)
  const service = new ProvidersService(root, () => {})
  let snapshot = await service.change({
    action: 'create',
    id: 'test-custom',
    name: 'Test custom',
    api: 'openai-completions',
    baseUrl: 'http://127.0.0.1:9/v1'
  })
  assert.ok(snapshot.providers.some(({ id }) => id === 'test-custom'))
  snapshot = await service.change({
    action: 'saveKey',
    id: 'test-custom',
    key: '!literal-key-not-command'
  })
  const view = snapshot.providers.find(({ id }) => id === 'test-custom')
  assert.equal(view.apiKeyConfigured, true)
  assert.equal(view.oauthConfigured, false)
  assert.equal(JSON.stringify(snapshot).includes('!literal-key-not-command'), false)
  await service.change({
    action: 'saveModel',
    id: 'test-custom',
    model: {
      id: 'chat',
      name: 'Chat',
      reasoning: true,
      vision: true,
      contextWindow: 8192,
      maxTokens: 1024
    }
  })
  assert.equal((await (await service.models()).runtime.getAvailable('test-custom')).length, 1)
  await service.change({ action: 'update', id: 'test-custom', enabled: false })
  assert.deepEqual(await (await service.models()).runtime.getAvailable('test-custom'), [])
  assert.equal(await (await service.models()).runtime.getAuth('test-custom'), undefined)
  await service.change({ action: 'update', id: 'test-custom', enabled: true })
  await service.change({
    action: 'setModelEnabled',
    id: 'test-custom',
    modelId: 'chat',
    enabled: false
  })
  assert.deepEqual(await (await service.models()).runtime.getAvailable('test-custom'), [])
  await service.change({ action: 'logout', id: 'test-custom', type: 'api_key' })
  const reloaded = await new ProvidersService(root, () => {}).get()
  assert.equal(reloaded.providers.find(({ id }) => id === 'test-custom').apiKeyConfigured, false)
  await service.change({ action: 'delete', id: 'test-custom' })
  assert.equal(
    (await service.get()).providers.some(({ id }) => id === 'test-custom'),
    false
  )
})

test('模型扩展思考档位可独立开关，保存并重载后保持生效', async (t) => {
  const root = await fixture(t)
  const service = new ProvidersService(root, () => {})
  await service.change({
    action: 'create',
    id: 'thinking-test',
    name: 'Thinking test',
    api: 'openai-completions',
    baseUrl: 'http://127.0.0.1:9/v1'
  })
  const model = {
    id: 'chat',
    name: 'Chat',
    reasoning: true,
    vision: false,
    contextWindow: 32768,
    maxTokens: 4096
  }
  const standardLevels = ['off', 'minimal', 'low', 'medium', 'high']
  await service.change({ action: 'saveModel', id: 'thinking-test', model })
  assert.deepEqual(
    getSupportedThinkingLevels((await service.models()).runtime.getModel('thinking-test', 'chat')),
    standardLevels
  )
  for (const [supportsXhigh, supportsMax] of [
    [true, false],
    [false, true],
    [true, true],
    [false, false]
  ]) {
    await service.change({
      action: 'saveModel',
      id: 'thinking-test',
      model: { ...model, supportsXhigh, supportsMax }
    })
    const reloaded = new ProvidersService(root, () => {})
    const view = (await reloaded.get()).providers.find(({ id }) => id === 'thinking-test').models[0]
    assert.equal(view.supportsXhigh, supportsXhigh)
    assert.equal(view.supportsMax, supportsMax)
    const saved = (await new EliConfigStore(join(root, 'config.json')).read()).providers[
      'thinking-test'
    ].models[0]
    assert.equal(saved.supportsXhigh, supportsXhigh)
    assert.equal(saved.supportsMax, supportsMax)
    assert.deepEqual(
      getSupportedThinkingLevels(
        (await reloaded.models()).runtime.getModel('thinking-test', 'chat')
      ),
      [...standardLevels, ...(supportsXhigh ? ['xhigh'] : []), ...(supportsMax ? ['max'] : [])]
    )
  }
  await service.change({
    action: 'saveModel',
    id: 'thinking-test',
    model: { ...model, reasoning: false, supportsXhigh: true, supportsMax: true }
  })
  assert.deepEqual(
    getSupportedThinkingLevels((await service.models()).runtime.getModel('thinking-test', 'chat')),
    ['off']
  )
  for (const field of ['supportsXhigh', 'supportsMax'])
    await assert.rejects(
      service.change({
        action: 'saveModel',
        id: 'thinking-test',
        model: { ...model, [field]: 'true' }
      }),
      /模型能力或 token 上限无效/
    )
})

test('内置模型编辑扩展档位时保留其余思考限制和接口适配能力', async (t) => {
  const root = await fixture(t)
  const service = new ProvidersService(root, () => {})
  const original = (await service.models()).runtime.getModel('google', 'gemini-3-flash-preview')
  assert.ok(original)
  const findModel = (snapshot) =>
    snapshot.providers.find(({ id }) => id === 'google').models.find(({ id }) => id === original.id)
  const initial = findModel(await service.get())
  assert.equal(initial.supportsXhigh, false)
  assert.equal(initial.supportsMax, false)
  await service.change({
    action: 'saveModel',
    id: 'google',
    model: { ...initial, supportsXhigh: true, supportsMax: true }
  })
  const changed = (await service.models()).runtime.getModel('google', original.id)
  assert.deepEqual(getSupportedThinkingLevels(changed), [
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
    'max'
  ])
  assert.deepEqual(changed.compat, original.compat)
  assert.deepEqual(changed.cost, original.cost)
  assert.equal(changed.thinkingLevelMap.off, null)
  assert.equal(changed.thinkingLevelMap.minimal, original.thinkingLevelMap.minimal)
  await service.change({
    action: 'saveModel',
    id: 'google',
    model: { ...findModel(await service.get()), supportsXhigh: false, supportsMax: false }
  })
  assert.deepEqual(
    getSupportedThinkingLevels((await service.models()).runtime.getModel('google', original.id)),
    getSupportedThinkingLevels(original)
  )
  const native = (await service.get()).providers
    .find(({ id }) => id === 'anthropic')
    .models.find(({ id }) => id === 'claude-opus-5-5')
  assert.equal(native.supportsXhigh, true)
  assert.equal(native.supportsMax, true)
})

test('供应商配置覆盖保留 SDK 的非聊天模型能力', async (t) => {
  const root = await fixture(t)
  const service = new ProvidersService(root, () => {})
  const before = (await service.models()).runtime.getModelsOfType('classifier', 'openai')
  assert.ok(before.length > 0)
  await service.change({ action: 'update', id: 'openai', authMode: 'api_key' })
  const after = (await service.models()).runtime.getModelsOfType('classifier', 'openai')
  assert.deepEqual(
    after.map(({ id }) => id),
    before.map(({ id }) => id)
  )
})

test('模型同步使用显式 API 地址和密钥，保留手动模型与停用设置', async (t) => {
  const root = await fixture(t)
  let requested = false
  const server = createServer((req, res) => {
    requested = true
    assert.equal(req.url, '/v1/models')
    assert.equal(req.headers.authorization, 'Bearer local-test-key')
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ data: [{ id: 'remote' }] }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  const service = new ProvidersService(root, () => {})
  await service.change({
    action: 'create',
    id: 'local-test',
    name: 'Local',
    api: 'openai-completions',
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`
  })
  await service.change({ action: 'saveKey', id: 'local-test', key: 'local-test-key' })
  await service.change({
    action: 'saveModel',
    id: 'local-test',
    model: {
      id: 'manual',
      name: 'Manual',
      reasoning: false,
      vision: false,
      contextWindow: 8192,
      maxTokens: 1024
    }
  })
  await service.change({ action: 'sync', id: 'local-test' })
  await service.change({
    action: 'setModelEnabled',
    id: 'local-test',
    modelId: 'remote',
    enabled: false
  })
  const snapshot = await service.change({ action: 'sync', id: 'local-test' })
  const models = snapshot.providers.find(({ id }) => id === 'local-test').models
  assert.equal(requested, true)
  assert.equal(models.find(({ id }) => id === 'remote').enabled, false)
  assert.ok(models.some(({ id }) => id === 'manual'))
})

test('订阅模式同步不访问为 API Key 保存的自定义地址', async (t) => {
  const root = await fixture(t)
  let refreshed = false
  const service = new ProvidersService(root, () => {})
  service.models = async () => ({
    preferences: { openai: { baseUrl: 'http://127.0.0.1:9/untrusted', authMode: 'oauth' } },
    credentials: { mode: async () => 'oauth' },
    builtinIds: new Set(['openai']),
    catalog: () => [],
    runtime: {
      getProvider: () => ({ id: 'openai' }),
      refresh: async (options) => {
        assert.deepEqual(options.providers, ['openai'])
        refreshed = true
        return { errors: new Map() }
      },
      getAuth: async () => {
        throw new Error('Subscription must not use custom API-key endpoint')
      }
    }
  })
  service.get = async () => ({ providers: [] })
  await service.change({ action: 'sync', id: 'openai' })
  assert.equal(refreshed, true)
})

test('SDK 登录交互成功和取消分别反映当前认证方式，不混淆另一份凭据', async (t) => {
  const root = await fixture(t)
  const service = new ProvidersService(root, () => {})
  service.models = async (type) => {
    const bundle = await createEliModels(root, type)
    bundle.runtime.registerNativeProvider(mockProvider())
    await bundle.runtime.refresh({ allowNetwork: false })
    return bundle
  }
  let snapshot
  const auth = new AgentAuthService(
    root,
    (next) => {
      snapshot = structuredClone(next)
    },
    false,
    service
  )
  t.after(() => auth.dispose())
  const waitFor = async (predicate) => {
    for (let count = 0; count < 500; count++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error('Login fixture timed out')
  }
  await auth.get()
  await auth.login('mock-dual', 'api_key')
  await waitFor(() => snapshot.prompt)
  auth.respond(snapshot.prompt.id, 'local-test-key')
  await waitFor(() => snapshot.status === 'success')
  await auth.get()
  const provider = (await service.get()).providers.find(({ id }) => id === 'mock-dual')
  assert.equal(provider.apiKeyConfigured, true)
  assert.equal(provider.oauthConfigured, false)
  await auth.login('mock-dual', 'oauth')
  await waitFor(() => snapshot.prompt)
  await auth.cancel()
  assert.equal(snapshot.status, 'idle')
  assert.equal(
    (await (await service.models('api_key')).credentials.getStored('mock-dual', 'api_key')).key,
    'local-test-key'
  )
})
