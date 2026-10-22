import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { AppUpdates } from '../src/main/app-updates.ts'

function release(tag = 'v1.0.4', overrides = {}) {
  return { tag_name: tag, draft: false, prerelease: false, ...overrides }
}

async function fixture(t, { version = '1.0.3', handler, timeoutMs } = {}) {
  let requests = 0
  const opened = []
  const snapshots = []
  const server = createServer((request, response) => {
    requests++
    if (handler) return handler(request, response)
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify(release()))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  const service = new AppUpdates({
    currentVersion: version,
    timeoutMs,
    fetch: (url, init) => {
      assert.equal(url, 'https://api.github.com/repos/DaNiuNai/eli/releases/latest')
      assert.equal(init.credentials, 'omit')
      assert.equal(init.cache, 'no-store')
      return fetch(`http://127.0.0.1:${server.address().port}/latest`, init)
    },
    openExternal: async (url) => opened.push(url),
    publish: (snapshot) => snapshots.push(snapshot)
  })
  return { service, opened, snapshots, requests: () => requests }
}

test('仅手动检查才联网；提示新版本后按需打开固定仓库的发行页', async (t) => {
  const { service, opened, snapshots, requests } = await fixture(t)
  assert.equal(service.get().currentVersion, '1.0.3')
  assert.equal(service.get().status, 'idle')
  assert.equal(requests(), 0)
  await assert.rejects(service.openRelease(), /先检查更新/)
  const result = await service.check()
  assert.equal(result.status, 'available')
  assert.equal(result.latestVersion, '1.0.4')
  assert.deepEqual(
    snapshots.map(({ status }) => status),
    ['checking', 'available']
  )
  assert.deepEqual(
    snapshots.map(({ revision }) => revision),
    [1, 2]
  )
  assert.deepEqual(opened, [])
  await service.openRelease()
  assert.deepEqual(opened, ['https://github.com/DaNiuNai/eli/releases/tag/v1.0.4'])
  assert.deepEqual(service.get(), result)
})

test('并发检查共享同一个请求，完成后允许再次检查', async (t) => {
  const { service, requests } = await fixture(t)
  const first = service.check()
  const second = service.check()
  assert.equal(first, second)
  assert.equal(service.get().status, 'checking')
  await Promise.all([first, second])
  assert.equal(requests(), 1)
  await service.check()
  assert.equal(requests(), 2)
})

test('按语义化版本比较，正确处理相同版本、降级、位数和预发布版本', async (t) => {
  for (const [current, latest, expected] of [
    ['1.0.3', 'v1.0.3', 'up-to-date'],
    ['1.0.4', 'v1.0.3', 'up-to-date'],
    ['1.9.0', 'v1.10.0', 'available'],
    ['2.0.0', 'v1.99.99', 'up-to-date'],
    ['1.0.4-beta.1', 'v1.0.4', 'available'],
    ['1.0.4+local', 'v1.0.4+release', 'up-to-date']
  ]) {
    await t.test(`${current} → ${latest}`, async (t) => {
      const { service } = await fixture(t, {
        version: current,
        handler: (_request, response) => response.end(JSON.stringify(release(latest)))
      })
      assert.equal((await service.check()).status, expected)
      if (expected === 'up-to-date') await assert.rejects(service.openRelease())
    })
  }
})

test('拒绝草稿、预发布、错误版本和损坏响应', async (t) => {
  for (const data of [
    release('v2.0.0', { draft: true }),
    release('v2.0.0', { prerelease: true }),
    release('v2.0.0-beta.1'),
    release('not-a-version'),
    release('v1.2'),
    {},
    null,
    'broken json'
  ]) {
    await t.test(JSON.stringify(data), async (t) => {
      const { service } = await fixture(t, {
        handler: (_request, response) =>
          response.end(typeof data === 'string' ? data : JSON.stringify(data))
      })
      const result = await service.check()
      assert.equal(result.status, 'error')
      assert.match(result.error, /无效的版本信息/)
      await assert.rejects(service.openRelease())
    })
  }
})

test('HTTP 失败显示可重试错误，重试成功会清除错误', async (t) => {
  for (const [status, message] of [
    [404, /没有可用的正式版本/],
    [403, /限制了请求/],
    [429, /限制了请求/],
    [500, /暂时不可用/]
  ]) {
    await t.test(String(status), async (t) => {
      let fail = true
      const { service } = await fixture(t, {
        handler: (_request, response) => {
          response.statusCode = fail ? status : 200
          response.end(JSON.stringify(release()))
        }
      })
      const result = await service.check()
      assert.equal(result.status, 'error')
      assert.match(result.error, message)
      fail = false
      const retry = await service.check()
      assert.equal(retry.status, 'available')
      assert.equal(retry.error, null)
    })
  }
})

test('请求超时中断连接并允许重试', async (t) => {
  let fail = true
  const { service } = await fixture(t, {
    timeoutMs: 100,
    handler: (_request, response) => {
      if (!fail) response.end(JSON.stringify(release()))
    }
  })
  const result = await service.check()
  assert.equal(result.status, 'error')
  assert.match(result.error, /超时/)
  fail = false
  assert.equal((await service.check()).status, 'available')
})

test('网络连接失败不会留下检查中状态', async (t) => {
  const { service } = await fixture(t, {
    handler: (request) => request.socket.destroy()
  })
  const result = await service.check()
  assert.equal(result.status, 'error')
  assert.match(result.error, /检查网络/)
})

test('忽略远端 html_url，不打开任意外部地址', async (t) => {
  const { service, opened } = await fixture(t, {
    handler: (_request, response) =>
      response.end(JSON.stringify(release('v1.0.4', { html_url: 'file:///untrusted.exe' })))
  })
  await service.check()
  await service.openRelease()
  assert.deepEqual(opened, ['https://github.com/DaNiuNai/eli/releases/tag/v1.0.4'])
})
