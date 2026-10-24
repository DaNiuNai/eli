import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { AutoSaveQueue } from '../src/renderer/src/lib/auto-save.ts'
import { AutoSaveFeedbackStore } from '../src/renderer/src/lib/auto-save-feedback.ts'

function gate() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function feedbackQueue(feedback, scope, save) {
  const owner = Symbol()
  const queue = new AutoSaveQueue(save, (key, state) => {
    feedback.report(JSON.stringify([scope, key]), owner, state, () =>
      queue.update(key, state.value, 0)
    )
  })
  return queue
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

test('统一提示汇总不同设置的保存进度，全部完成后才显示已保存', async () => {
  const feedback = new AutoSaveFeedbackStore()
  const active = gate()
  const snapshots = []
  const unsubscribe = feedback.subscribe(() => snapshots.push(feedback.getSnapshot().status))
  const terminal = feedbackQueue(feedback, 'terminal', async () => {})
  const agent = feedbackQueue(feedback, 'agent', async () => active.promise)
  assert.equal(feedback.getSnapshot().status, null)
  assert.equal(feedback.getSnapshot(), feedback.getSnapshot())
  terminal.update('path', 'pwsh.exe', 10000)
  assert.equal(feedback.getSnapshot().status, 'pending')
  agent.update('model', 'local', 0)
  assert.equal(feedback.getSnapshot().status, 'saving')
  active.resolve()
  await agent.flush()
  assert.equal(feedback.getSnapshot().status, 'pending')
  await terminal.flush()
  assert.equal(feedback.getSnapshot().status, 'saved')
  assert.deepEqual(feedback.getSnapshot().failures, [])
  assert.deepEqual(snapshots, ['pending', 'pending', 'saving', 'pending', 'saving', 'saved'])
  unsubscribe()
  terminal.update('path', 'powershell.exe', 0)
  await terminal.flush()
  assert.equal(snapshots.length, 6)
})

test('其他设置成功不能覆盖保存失败，统一提示可重试原字段且不暴露输入值', async () => {
  const feedback = new AutoSaveFeedbackStore()
  const attempts = []
  let failing = true
  const provider = feedbackQueue(feedback, 'provider', async (key, value) => {
    attempts.push([key, value])
    if (failing) throw new Error('模拟保存失败')
  })
  const skill = feedbackQueue(feedback, 'skill', async () => {})
  provider.update('key', 'feedback-test-private-value', 0)
  await provider.flush()
  skill.update('enabled', true, 0)
  await skill.flush()
  const snapshot = feedback.getSnapshot()
  assert.equal(snapshot.status, 'error')
  assert.equal(snapshot.failures.length, 1)
  assert.equal(snapshot.failures[0].error, '模拟保存失败')
  assert.equal(JSON.stringify(snapshot).includes('feedback-test-private-value'), false)
  failing = false
  snapshot.failures[0].retry()
  await provider.flush()
  assert.deepEqual(attempts, [
    ['key', 'feedback-test-private-value'],
    ['key', 'feedback-test-private-value']
  ])
  assert.equal(feedback.getSnapshot().status, 'saved')
  assert.deepEqual(feedback.getSnapshot().failures, [])
})

test('切换分类重新修改同一字段后，旧组件的迟到成功或失败不能覆盖新状态', async () => {
  for (const oldFails of [false, true]) {
    const feedback = new AutoSaveFeedbackStore()
    const oldRequest = gate()
    const newRequest = gate()
    const previous = feedbackQueue(feedback, 'settings', async () => {
      await oldRequest.promise
      if (oldFails) throw new Error('过期失败')
    })
    const current = feedbackQueue(feedback, 'settings', async () => newRequest.promise)
    previous.update('model', 'old', 0)
    current.update('model', 'new', 10000)
    oldRequest.resolve()
    await previous.flush()
    assert.equal(feedback.getSnapshot().status, 'pending')
    assert.deepEqual(feedback.getSnapshot().failures, [])
    const done = current.flush()
    assert.equal(feedback.getSnapshot().status, 'saving')
    newRequest.resolve()
    await done
    assert.equal(feedback.getSnapshot().status, 'saved')
  }
})
