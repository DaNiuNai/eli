import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { EliConfigStore } from '../src/config/store.ts'
import { McpService } from '../src/runtime/mcp.ts'
import { mcpHttpServer } from './fixtures/mcp-http.mjs'
import { mcpOAuthServer } from './fixtures/mcp-oauth.mjs'
import { sdkModules } from '../src/runtime/sdk-adapter.ts'

async function fixture(t) {
  const temporary = resolve('.tmp')
  await mkdir(temporary, { recursive: true })
  const directory = await mkdtemp(join(temporary, 'mcp-test-'))
  const root = join(directory, '.eli')
  const cwd = join(directory, 'workspace')
  await mkdir(root, { recursive: true })
  await mkdir(cwd, { recursive: true })
  const service = new McpService(root, cwd)
  t.after(async () => {
    await service.close()
    assert.ok(directory.startsWith(`${temporary}\\`) || directory.startsWith(`${temporary}/`))
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })
  return { directory, root, cwd, service, path: join(root, 'config.json') }
}

test('MCP 增删改、启停原子保存到统一配置，保留其他字段并拒绝重复名称和并发覆盖', async (t) => {
  const f = await fixture(t)
  const store = new EliConfigStore(f.path)
  await store.update((config) => {
    config.app.theme = 'dark'
    config.credentials['api_key:test'] = { type: 'api_key', key: 'mcp-unrelated-secret' }
  })
  assert.deepEqual(await f.service.get(), [])
  const config = { command: 'node', args: ['server.mjs'], env: { TEST: 'fixture' } }
  await f.service.change({ action: 'create', name: 'local', config })
  await f.service.change({ action: 'setEnabled', name: 'local', enabled: false })
  assert.equal((await f.service.get())[0].config.enabled, false)
  const existing = (await f.service.get())[0].config
  const next = { type: 'http', url: 'http://127.0.0.1:9/mcp', exposure: 'direct', enabled: true }
  await f.service.change({ action: 'update', name: 'local', config: next, expected: existing })
  await assert.rejects(
    f.service.change({ action: 'update', name: 'local', config, expected: existing }),
    /其他操作修改/
  )
  await assert.rejects(f.service.change({ action: 'create', name: 'local', config }), /已存在/)
  await assert.rejects(
    f.service.change({ action: 'delete', name: 'local', expected: existing }),
    /其他操作修改/
  )
  assert.deepEqual((await f.service.get())[0].config, next)
  await f.service.change({ action: 'delete', name: 'local', expected: next })
  assert.deepEqual(await f.service.get(), [])
  const saved = await store.read()
  assert.equal(saved.app.theme, 'dark')
  assert.equal(saved.credentials['api_key:test'].key, 'mcp-unrelated-secret')
  assert.equal(JSON.stringify(await f.service.get()).includes('mcp-unrelated-secret'), false)
})

test('MCP 校验拒绝无效传输、参数、命名空间冲突且失败不写入', async (t) => {
  const f = await fixture(t)
  await f.service.change({ action: 'create', name: 'test-server', config: { command: 'node' } })
  const before = await readFile(f.path, 'utf8')
  for (const change of [
    { action: 'create', name: 'test_server', config: { command: 'node' } },
    { action: 'create', name: '__proto__', config: { command: 'node' } },
    { action: 'create', name: 'has space', config: { command: 'node' } },
    ...[
      null,
      {},
      { command: '' },
      { command: 'node', args: [1] },
      { command: 'node', env: { A: 1 } },
      { url: 'file:///private' },
      { type: 'sse', url: 'http://localhost' },
      { url: 'https://localhost', headers: [] },
      { command: 'node', url: 'http://localhost' },
      { command: 'node', timeout: -1 }
    ].map((config) => ({ action: 'create', name: 'invalid', config })),
    { action: 'setEnabled', name: 'test-server', enabled: 'false' },
    { action: 'unknown', name: 'test-server' },
    { action: 'delete', name: 'missing' }
  ])
    await assert.rejects(f.service.change(change))
  assert.equal(await readFile(f.path, 'utf8'), before)
  await writeFile(f.path, JSON.stringify({ mcpServers: [] }))
  await assert.rejects(f.service.get(), /无法读取 Eli 配置/)
})

test('stdio 测试发现工具、使用指定工作目录，并关闭子进程；测试不会调用工具', async (t) => {
  const f = await fixture(t)
  const log = join(f.directory, 'stdio.log')
  await f.service.change({
    action: 'create',
    name: 'stdio',
    config: {
      command: process.execPath,
      args: [resolve('tests/fixtures/mcp-stdio.mjs'), log],
      enabled: false
    }
  })
  const before = await readFile(f.path, 'utf8')
  const result = await f.service.test('stdio', f.directory)
  assert.equal(result.status, 'connected')
  assert.deepEqual(
    result.tools.map(({ name }) => name),
    ['echo']
  )
  const events = (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse)
  assert.equal(events[0].cwd.toLowerCase(), f.directory.toLowerCase())
  assert.ok(events.some(({ method }) => method === 'tools/list'))
  assert.ok(events.every(({ method }) => method !== 'tools/call'))
  assert.throws(() => process.kill(events[0].pid, 0))
  assert.equal(await readFile(f.path, 'utf8'), before)
})

test('HTTP 测试发送配置的认证请求头、读取分页工具列表并区分认证失败', async (t) => {
  const f = await fixture(t)
  const server = await mcpHttpServer(t, { requireAuth: true })
  await f.service.change({
    action: 'create',
    name: 'http',
    config: { url: server.url, headers: { Authorization: 'Bearer mcp-test-only' } }
  })
  const result = await f.service.test('http')
  assert.equal(result.status, 'connected')
  assert.deepEqual(
    result.tools.map(({ name }) => name),
    ['echo', 'second']
  )
  assert.ok(server.requests.every(({ method }) => method !== 'tools/call'))
  await f.service.change({ action: 'create', name: 'unauthorized', config: { url: server.url } })
  const rejected = await f.service.test('unauthorized')
  assert.equal(rejected.status, 'needs-auth')
  assert.equal(rejected.authentication.method, 'manual')
  assert.deepEqual(rejected.tools, [])
  assert.equal(JSON.stringify(rejected).includes('mcp-test-only'), false)
  const invalid = await mcpHttpServer(t, { rejectAuth: true })
  await f.service.change({
    action: 'create',
    name: 'expired-token',
    config: { url: invalid.url, headers: { Authorization: 'Bearer expired-test-only' } }
  })
  const expired = await f.service.test('expired-token')
  assert.equal(expired.status, 'needs-auth')
  assert.equal(expired.authentication.method, 'manual')
  await assert.rejects(f.service.startAuth('expired-token'), /请求头/)
})

async function until(predicate) {
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    const value = predicate()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('等待 MCP 授权状态超时')
}

async function credentialStore(root) {
  const sdk = await sdkModules()
  return new sdk.McpOAuthCredentialStore(
    new sdk.FileAuthStorageBackend(join(root, 'mcp-auth.json')),
    join(root, 'mcp-locks')
  )
}

test('认证状态区分未认证、请求头待验证、已认证、过期和本地服务，状态不包含凭据', async (t) => {
  const f = await fixture(t)
  const http = await mcpHttpServer(t, { requireAuth: true })
  for (const [name, config] of Object.entries({
    anonymous: { url: http.url },
    manual: { url: http.url, headers: { Authorization: 'Bearer mcp-test-only' } },
    oauth: { url: http.url },
    expired: { url: http.url },
    local: { command: 'node' }
  }))
    await f.service.change({ action: 'create', name, config })
  const store = await credentialStore(f.root)
  for (const name of ['oauth', 'expired'])
    await store.forServer(name, http.url).save({
      serverUrl: http.url,
      tokens: {
        access_token: `test-status-secret-${name}`,
        token_type: 'Bearer',
        refresh_token: 'test-status-refresh-secret'
      },
      tokensExpireAt: Date.now() + (name === 'expired' ? -1000 : 3600000)
    })
  const all = await f.service.get()
  const state = Object.fromEntries(all.map(({ name, authentication }) => [name, authentication]))
  assert.equal(state.anonymous.state, 'unauthenticated')
  assert.equal(state.manual.state, 'configured')
  assert.equal(state.manual.method, 'manual')
  assert.equal(state.oauth.state, 'authenticated')
  assert.equal(state.oauth.method, 'oauth')
  assert.equal(state.expired.state, 'expired')
  assert.equal(state.local.method, 'local')
  assert.equal(state.local.canSignOut, false)
  assert.equal(JSON.stringify(state).includes('test-status-secret'), false)
  assert.equal(JSON.stringify(state).includes('test-status-refresh-secret'), false)
  await f.service.test('manual')
  assert.equal(
    (await f.service.get()).find(({ name }) => name === 'manual').authentication.state,
    'authenticated'
  )
  await f.service.test('anonymous')
  assert.equal(
    (await f.service.get()).find(({ name }) => name === 'anonymous').authentication.state,
    'needs-auth'
  )
  const publicServer = await mcpHttpServer(t)
  await f.service.change({ action: 'create', name: 'public', config: { url: publicServer.url } })
  await f.service.test('public')
  assert.equal(
    (await f.service.get()).find(({ name }) => name === 'public').authentication.state,
    'not-required'
  )
  await writeFile(join(f.root, 'mcp-auth.json'), '{ "private-malformed-token": ')
  await assert.rejects(
    f.service.get(),
    (error) => !error.message.includes('private-malformed-token') && /认证信息/.test(error.message)
  )
})

test('退出认证清除 Authorization 与本服务 OAuth，保留其他请求头、服务配置和供应商凭据', async (t) => {
  const f = await fixture(t)
  const server = await mcpHttpServer(t, { requireAuth: true })
  await f.service.change({
    action: 'create',
    name: 'manual',
    config: {
      url: server.url,
      enabled: false,
      headers: { aUtHoRiZaTiOn: 'Bearer mcp-test-only', 'X-Tenant': 'keep-tenant' }
    }
  })
  const store = await credentialStore(f.root)
  for (const name of ['manual', 'other'])
    await store.forServer(name, server.url).save({
      serverUrl: server.url,
      tokens: { access_token: `sign-out-test-${name}`, token_type: 'Bearer' }
    })
  const result = await f.service.signOut('manual')
  assert.deepEqual(result[0].config.headers, { 'X-Tenant': 'keep-tenant' })
  assert.equal(result[0].config.url, server.url)
  assert.equal(result[0].config.enabled, false)
  assert.equal(result[0].authentication.state, 'unauthenticated')
  assert.equal(store.tokens('manual', server.url), undefined)
  assert.equal(store.tokens('other', server.url).access_token, 'sign-out-test-other')
  assert.equal(f.service.getAuth().status, 'signed-out')
  await f.service.change({
    action: 'create',
    name: 'provider',
    config: { url: server.url, auth: { provider: 'shared' } }
  })
  await new EliConfigStore(f.path).update((config) => {
    config.credentials['api_key:shared'] = { type: 'api_key', key: 'shared-provider-test-secret' }
  })
  await f.service.signOut('provider')
  assert.equal(
    (await f.service.get()).find(({ name }) => name === 'provider').config.auth,
    undefined
  )
  assert.equal(
    (await new EliConfigStore(f.path).read()).credentials['api_key:shared'].key,
    'shared-provider-test-secret'
  )
  await assert.rejects(f.service.signOut('missing'), /请选择/)
  await f.service.change({ action: 'create', name: 'local', config: { command: 'node' } })
  await assert.rejects(f.service.signOut('local'), /远程/)
})

test('已认证 OAuth 可强制重新打开浏览器，退出后重启仍未认证，重新授权后恢复', async (t) => {
  const f = await fixture(t)
  const oauth = await mcpOAuthServer(t)
  await f.service.change({ action: 'create', name: 'oauth', config: { url: oauth.url } })
  const originalConfig = await readFile(f.path, 'utf8')
  await f.service.startAuth('oauth')
  const first = await until(() => f.service.getAuth().authorizationUrl && f.service.getAuth())
  await fetch(first.authorizationUrl)
  await until(() => f.service.getAuth().status === 'success')
  assert.equal((await f.service.get())[0].authentication.state, 'authenticated')
  await f.service.startAuth('oauth', true)
  const second = await until(() => f.service.getAuth().authorizationUrl && f.service.getAuth())
  assert.notEqual(first.id, second.id)
  assert.equal((await f.service.get())[0].authentication.state, 'authorizing')
  await fetch(second.authorizationUrl)
  await until(() => f.service.getAuth().status === 'success')
  assert.equal(oauth.exchanges(), 2)
  const signedOut = await f.service.signOut('oauth')
  assert.equal(signedOut[0].authentication.state, 'unauthenticated')
  assert.equal(await readFile(f.path, 'utf8'), originalConfig)
  const restarted = new McpService(f.root, f.cwd)
  t.after(() => restarted.close())
  assert.equal((await restarted.get())[0].authentication.state, 'unauthenticated')
  assert.equal((await restarted.test('oauth')).status, 'needs-auth')
  await restarted.startAuth('oauth')
  const third = await until(() => restarted.getAuth().authorizationUrl && restarted.getAuth())
  await fetch(third.authorizationUrl)
  await until(() => restarted.getAuth().status === 'success')
  assert.equal((await restarted.get())[0].authentication.state, 'authenticated')
  assert.equal(oauth.exchanges(), 3)
})

test('退出正在进行的 OAuth 会取消回调，迟到的授权不能恢复本地认证', async (t) => {
  const f = await fixture(t)
  const oauth = await mcpOAuthServer(t)
  await f.service.change({ action: 'create', name: 'oauth', config: { url: oauth.url } })
  await f.service.startAuth('oauth')
  const pending = await until(() => f.service.getAuth().authorizationUrl && f.service.getAuth())
  const callback = new URL(pending.authorizationUrl).searchParams.get('redirect_uri')
  const signedOut = await f.service.signOut('oauth')
  assert.equal(signedOut[0].authentication.state, 'unauthenticated')
  assert.equal(f.service.getAuth().status, 'signed-out')
  await assert.rejects(fetch(callback))
  assert.throws(() => f.service.respondAuth(pending.id, callback), /无效/)
  assert.equal(oauth.exchanges(), 0)
  await assert.rejects(f.service.startAuth('oauth', 'true'), /无效/)
})

test('OAuth 发现、PKCE 浏览器回调及凭据复用，授权状态不包含令牌', async (t) => {
  const f = await fixture(t)
  const oauth = await mcpOAuthServer(t)
  const snapshots = []
  const service = new McpService(f.root, f.cwd, (snapshot) => snapshots.push(snapshot))
  t.after(() => service.close())
  await service.change({ action: 'create', name: 'oauth', config: { url: oauth.url } })
  const before = await readFile(f.path, 'utf8')
  const testResult = await service.test('oauth')
  assert.equal(testResult.status, 'needs-auth')
  assert.equal(testResult.authentication.method, 'oauth')
  assert.equal(await service.website('oauth'), new URL('/docs/auth', oauth.url).href)
  await service.startAuth('oauth')
  const pending = await until(() => snapshots.find((snapshot) => snapshot.authorizationUrl))
  assert.equal(service.validateAuthLink(pending.id), pending.authorizationUrl)
  assert.throws(() => service.validateAuthLink('stale-id'), /失效/)
  await assert.rejects(service.startAuth('oauth'), /先完成/)
  await assert.rejects(
    service.change({ action: 'setEnabled', name: 'oauth', enabled: false }),
    /先完成/
  )
  const browser = await fetch(pending.authorizationUrl)
  assert.equal(browser.status, 200)
  const success = await until(() => snapshots.find((snapshot) => snapshot.status === 'success'))
  assert.equal(success.result.status, 'connected')
  assert.deepEqual(
    success.result.tools.map(({ name }) => name),
    ['echo']
  )
  assert.equal(success.authorizationUrl, undefined)
  assert.equal(oauth.exchanges(), 1)
  assert.equal(oauth.calls.length, 0)
  assert.equal(JSON.stringify(snapshots).includes('eli-mcp-test-access-token'), false)
  assert.equal(await readFile(f.path, 'utf8'), before)
  assert.throws(() => service.validateAuthLink(pending.id), /失效/)
  await service.close()
  assert.equal((await f.service.test('oauth')).status, 'connected')
  assert.equal(oauth.exchanges(), 1)
})

test('OAuth 允许粘贴回调地址，拒绝过期步骤；取消会关闭回调端口且可以重新授权', async (t) => {
  const f = await fixture(t)
  const oauth = await mcpOAuthServer(t)
  await f.service.change({ action: 'create', name: 'oauth', config: { url: oauth.url } })
  await f.service.startAuth('oauth')
  const first = await until(() => f.service.getAuth().authorizationUrl && f.service.getAuth())
  const callback = new URL(first.authorizationUrl).searchParams.get('redirect_uri')
  assert.throws(() => f.service.respondAuth('stale-id', 'http://127.0.0.1/callback'), /无效/)
  await f.service.cancelAuth(first.id)
  assert.equal(f.service.getAuth().status, 'idle')
  await assert.rejects(fetch(callback))
  await f.service.startAuth('oauth')
  const second = await until(() => f.service.getAuth().authorizationUrl && f.service.getAuth())
  assert.notEqual(first.id, second.id)
  await assert.rejects(f.service.cancelAuth(first.id), /步骤已变化/)
  const response = await fetch(second.authorizationUrl, { redirect: 'manual' })
  assert.equal(response.status, 302)
  f.service.respondAuth(second.id, response.headers.get('location'))
  await until(() => f.service.getAuth().status === 'success')
  assert.equal(oauth.exchanges(), 1)
})

test('OAuth 失败提供手动令牌指引，关闭管理服务会取消授权', async (t) => {
  const f = await fixture(t)
  const apiKey = await mcpHttpServer(t, { requireAuth: true })
  await f.service.change({ action: 'create', name: 'api-key', config: { url: apiKey.url } })
  await f.service.startAuth('api-key')
  const failed = await until(() => f.service.getAuth().status === 'error' && f.service.getAuth())
  assert.match(failed.error, /API Key|控制台/)
  assert.equal(failed.authorizationUrl, undefined)
  const oauth = await mcpOAuthServer(t)
  await f.service.change({ action: 'create', name: 'oauth', config: { url: oauth.url } })
  await f.service.startAuth('oauth')
  const pending = await until(() => f.service.getAuth().authorizationUrl && f.service.getAuth())
  const callback = new URL(pending.authorizationUrl).searchParams.get('redirect_uri')
  await f.service.close()
  await assert.rejects(fetch(callback))
  assert.equal(f.service.getAuth().status, 'idle')
})

test('失败和超时测试会收回子进程，关闭管理服务会取消正在建立的连接', async (t) => {
  const f = await fixture(t)
  await f.service.change({
    action: 'create',
    name: 'missing',
    config: { command: join(f.directory, 'missing-command.exe') }
  })
  assert.equal((await f.service.test('missing')).status, 'failed')
  const log = join(f.directory, 'timeout.log')
  await f.service.change({
    action: 'create',
    name: 'timeout',
    config: {
      command: process.execPath,
      args: [resolve('tests/fixtures/mcp-stdio.mjs'), log, '--stall'],
      timeout: 0.3
    }
  })
  const result = await f.service.test('timeout')
  assert.equal(result.status, 'failed')
  assert.match(result.message, /超时/)
  const pid = JSON.parse((await readFile(log, 'utf8')).split('\n')[0]).pid
  assert.throws(() => process.kill(pid, 0))
  await assert.rejects(f.service.test('not-found'), /不存在/)
  const pending = f.service.test('timeout')
  await new Promise((resolve) => setTimeout(resolve, 50))
  await f.service.close()
  assert.equal((await pending).status, 'failed')
  await assert.rejects(f.service.test('timeout'), /已关闭/)
})
