import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createServer } from 'node:http'
import { createEliModels, isolateProviderAuth } from '../src/runtime/models.ts'
import { ProvidersService } from '../src/runtime/providers.ts'
import { AgentAuthService } from '../src/runtime/auth.ts'
import { closeNetwork } from '../src/runtime/network.ts'

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
  const saved = JSON.parse(await readFile(join(root, 'auth.json'), 'utf8'))
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
