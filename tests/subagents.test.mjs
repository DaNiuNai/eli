import test from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { SubagentTeam } from '../src/runtime/subagents.ts'
import { emptySessionSnapshot } from '../src/shared/agent-state.ts'
import { RuntimeInteractions } from '../src/runtime/interactions.ts'
import { buildChatEntries } from '../src/renderer/src/lib/chat-entries.ts'

function fixture(t, initialize) {
  const agents = new Map()
  const checkpoints = []
  function agent(id, messages = []) {
    const snapshot = emptySessionSnapshot('.tmp/subagents-test', id)
    snapshot.messages = structuredClone(messages)
    snapshot.model = { provider: 'test', id: 'local', contextWindow: 32768, reasoning: true }
    snapshot.models = [snapshot.model, { ...snapshot.model, id: 'other' }]
    snapshot.session.thinkingLevel = 'high'
    const runtime = {
      snapshot,
      interactions: new RuntimeInteractions('request', () => {}),
      delivered: [],
      prompts: [],
      disposed: false,
      async initialize() {
        await initialize?.(id)
      },
      state() {
        return { snapshot }
      },
      prompt(text) {
        this.prompts.push(text)
        snapshot.running = true
      },
      async abort() {
        snapshot.running = false
      },
      async dispose() {
        this.disposed = true
        snapshot.running = false
      },
      stopBackgroundTask() {
        return undefined
      },
      collaborationMessage(text, wake) {
        this.delivered.push({ text, wake })
        if (wake) snapshot.running = true
      },
      inheritedMessages() {
        return structuredClone(snapshot.messages)
      }
    }
    agents.set(id, runtime)
    return runtime
  }
  const root = agent('/root', [{ role: 'user', content: 'root context', timestamp: 1 }])
  const created = []
  const team = new SubagentTeam(
    '.tmp/subagents-test',
    root,
    (options) => {
      created.push(options)
      return agent(options.id, options.messages)
    },
    () => {},
    (members) => checkpoints.push(structuredClone(members))
  )
  t.after(() => team.close())
  return { team, root, agents, checkpoints, created }
}

test('协作消息在对话中展示来源与正文', () => {
  const entries = buildChatEntries([
    {
      role: 'custom',
      customType: 'eli.collaboration',
      display: true,
      timestamp: 1,
      content: 'internal envelope',
      details: {
        type: 'MESSAGE',
        sender: '/root/worker',
        recipient: '/root',
        text: 'review complete'
      }
    }
  ])
  assert.equal(entries[0].groups[0].kind, 'collaboration')
  assert.equal(entries[0].groups[0].sender, '/root/worker')
  assert.equal(entries[0].groups[0].text, 'review complete')
})

test('全部层级共享并发上限，启动中也预占槽位，完成后能复用成员', async (t) => {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const { team, agents } = fixture(t, (id) => (id === '/root/slow' ? gate : undefined))
  const slow = team.spawn('/root', { task_name: 'slow', message: 'slow' })
  t.after(release)
  await team.spawn('/root', { task_name: 'other', message: 'other' })
  await team.spawn('/root/other', { task_name: 'nested', message: 'nested' })
  await assert.rejects(
    team.spawn('/root', { task_name: 'overflow', message: 'overflow' }),
    /并发槽位/
  )
  release()
  await slow
  agents.get('/root/slow').snapshot.running = false
  team.settled('/root/slow')
  assert.equal(team.list().find(({ id }) => id === '/root/slow').status, 'completed')
  team.send('/root', 'slow', 'again', true)
  assert.equal(team.list().find(({ id }) => id === '/root/slow').status, 'running')
  assert.equal(team.list().length, 3)
})

test('继承上下文与模型，独立上下文允许覆盖，拒绝重名和无效设置', async (t) => {
  const { team, root, agents, created } = fixture(t)
  await team.spawn('/root', { task_name: 'inherited', message: 'inspect' })
  assert.deepEqual(created[0].messages, root.snapshot.messages)
  assert.deepEqual(created[0].selection, {
    provider: 'test',
    modelId: 'local',
    thinkingLevel: 'high'
  })
  agents.get('/root/inherited').snapshot.messages[0].content = 'changed'
  assert.equal(root.snapshot.messages[0].content, 'root context')
  await team.spawn('/root', {
    task_name: 'fresh',
    message: 'new',
    fork_turns: 'none',
    model: 'test/other',
    reasoning_effort: 'low'
  })
  assert.equal(created[1].messages, undefined)
  assert.equal(created[1].selection.modelId, 'other')
  await assert.rejects(
    team.spawn('/root', { task_name: 'inherited', message: 'duplicate' }),
    /同名/
  )
  await assert.rejects(
    team.spawn('/root', { task_name: '../bad', message: 'invalid' }),
    /task_name/
  )
  await assert.rejects(
    team.spawn('/root', { task_name: 'override', message: 'invalid', model: 'other' }),
    /覆盖设置/
  )
  await assert.rejects(
    team.spawn('/root', {
      task_name: 'missing',
      message: 'invalid',
      fork_turns: 'none',
      model: 'missing'
    }),
    /模型不可用/
  )
})

test('完成结果自动送达父成员，跨分支消息不唤醒空闲成员，追加任务唤醒成员', async (t) => {
  const { team, root, agents } = fixture(t)
  await team.spawn('/root', { task_name: 'first', message: 'first' })
  await team.spawn('/root', { task_name: 'second', message: 'second' })
  const first = agents.get('/root/first')
  first.snapshot.messages.push({
    role: 'assistant',
    content: [{ type: 'text', text: 'final result' }],
    stopReason: 'stop'
  })
  first.snapshot.running = false
  team.settled('/root/first')
  assert.match(root.delivered.at(-1).text, /FINAL_ANSWER[\s\S]*final result/)
  assert.equal(root.delivered.at(-1).wake, true)
  team.send('/root/second', 'first', 'cross branch', false)
  assert.equal(first.delivered.at(-1).wake, false)
  assert.equal(team.list().find(({ id }) => id === '/root/first').status, 'completed')
  team.send('/root', 'first', 'next task', true)
  assert.equal(first.delivered.at(-1).wake, true)
  assert.equal(team.list().find(({ id }) => id === '/root/first').task, 'next task')
  assert.throws(() => team.send('/root', '/root', 'self', false), /自己/)
})

test('等待只消费自己的信箱，支持取消，不会丢失先到达的消息', async (t) => {
  const { team } = fixture(t)
  await team.spawn('/root', { task_name: 'worker', message: 'work' })
  const controller = new AbortController()
  const cancelled = team.wait('/root', 10000, controller.signal)
  controller.abort()
  await assert.rejects(cancelled, /取消/)
  const waiting = team.wait('/root', 10000)
  team.send('/root/worker', '/root', 'ready', false)
  const received = await waiting
  assert.equal(received.events[0].text, 'ready')
  assert.equal(received.timed_out, false)
  team.send('/root', 'worker', 'queued', false)
  assert.equal((await team.wait('/root/worker', 10000)).events[0].text, 'queued')
})

test('中断成员同时中断其后代，保留历史，停止团队后不会自动唤醒主成员', async (t) => {
  const { team, root, agents } = fixture(t)
  await team.spawn('/root', { task_name: 'parent', message: 'parent' })
  await team.spawn('/root/parent', { task_name: 'child', message: 'child' })
  const interrupted = await team.interrupt('/root', 'parent')
  assert.equal(interrupted.previous_status, 'running')
  assert.ok(team.list().every(({ status }) => status === 'interrupted'))
  assert.equal(agents.get('/root/parent/child').snapshot.running, false)
  await assert.rejects(team.interrupt('/root/parent/child', '/root/parent'), /祖先/)
  team.send('/root', 'parent', 'continue', true)
  await team.abortAll()
  const count = root.delivered.length
  team.settled('/root/parent')
  assert.equal(root.delivered.length, count)
  assert.ok(team.list().every(({ status }) => status === 'interrupted'))
  await assert.rejects(team.spawn('/root', { task_name: 'late', message: 'late' }), /停止/)
})

test('启动失败释放并发槽位，关闭时等待尚在初始化的成员并释放资源', async (t) => {
  const { team, agents } = fixture(t, (id) => {
    if (id.endsWith('/broken')) throw new Error('init failed')
  })
  await assert.rejects(
    team.spawn('/root', { task_name: 'broken', message: 'broken' }),
    /init failed/
  )
  assert.equal(team.list()[0].status, 'failed')
  assert.equal(agents.get('/root/broken').disposed, true)
  await team.spawn('/root', { task_name: 'ok', message: 'ok' })
  assert.equal(team.list().find(({ taskName }) => taskName === 'ok').status, 'running')
  await team.close()
  await nextTurn()
  assert.equal(agents.get('/root/ok').disposed, true)
})
