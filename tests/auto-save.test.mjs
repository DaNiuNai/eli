import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { AutoSaveQueue } from '../src/renderer/src/lib/auto-save.ts'

function gate() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test('自动保存合并连续输入，关闭面板前可立即提交最后的值', async () => {
  const writes = []
  const states = []
  const queue = new AutoSaveQueue(
    async (key, value) => {
      writes.push([key, value])
    },
    (key, state) => states.push([key, state])
  )
  queue.update('endpoint', 'http://local', 10000)
  queue.update('endpoint', 'http://localhost/v1', 10000)
  assert.deepEqual(writes, [])
  await queue.flush()
  assert.deepEqual(writes, [['endpoint', 'http://localhost/v1']])
  assert.equal(states.at(-1)[1].status, 'saved')
})

test('保存期间继续修改，旧响应不能清除新输入或显示过期的成功状态', async () => {
  const first = gate()
  const writes = []
  const states = []
  let running = 0
  const queue = new AutoSaveQueue(
    async (_key, value) => {
      assert.equal(++running, 1)
      writes.push(value)
      if (value === 'first') await first.promise
      running--
    },
    (_key, state) => states.push(state)
  )
  queue.update('model', 'first', 0)
  queue.update('model', 'latest', 0)
  first.resolve()
  await queue.flush()
  assert.deepEqual(writes, ['first', 'latest'])
  assert.deepEqual(
    states.filter((state) => state.status === 'saved').map((state) => state.value),
    ['latest']
  )
})

test('一个字段校验失败不阻止其他字段保存，修正后可自动重试', async () => {
  const writes = []
  const states = new Map()
  const queue = new AutoSaveQueue(
    async (key, value) => {
      if (key === 'json') JSON.parse(value)
      writes.push([key, value])
    },
    (key, state) => states.set(key, state)
  )
  queue.update('json', '{', 0)
  queue.update('enabled', 'true', 0)
  await queue.flush()
  assert.equal(states.get('json').status, 'error')
  assert.equal(states.get('json').value, '{')
  assert.deepEqual(writes, [['enabled', 'true']])
  queue.update('json', '{}', 0)
  await queue.flush()
  assert.equal(states.get('json').status, 'saved')
})

test('请求失败后出现新输入时，过期错误不会覆盖最新状态', async () => {
  const first = gate()
  const states = []
  const queue = new AutoSaveQueue(
    async (_key, value) => {
      if (value === 'old') {
        await first.promise
        throw new Error('old failure')
      }
    },
    (_key, state) => states.push(state)
  )
  queue.update('path', 'old', 0)
  queue.update('path', 'new', 0)
  first.resolve()
  await queue.flush()
  assert.equal(
    states.some((state) => state.status === 'error'),
    false
  )
  assert.equal(states.at(-1).value, 'new')
  assert.equal(states.at(-1).status, 'saved')
})

test('其他请求期间到期的防抖任务也会继续保存，不会留在队列中', async () => {
  const first = gate()
  const third = gate()
  const thirdStarted = gate()
  const writes = []
  const queue = new AutoSaveQueue(
    async (key) => {
      writes.push(key)
      if (key === 'first') await first.promise
      if (key === 'third') {
        thirdStarted.resolve()
        await third.promise
      }
    },
    () => {}
  )
  queue.update('first', '', 0)
  queue.update('delayed', '', 5)
  queue.update('third', '', 0)
  first.resolve()
  await thirdStarted.promise
  await delay(20)
  third.resolve()
  await queue.flush()
  assert.deepEqual(writes, ['first', 'third', 'delayed'])
})
