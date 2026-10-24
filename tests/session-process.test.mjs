import test from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { resolve } from 'node:path'
import { SessionProcess } from '../src/main/session-process.ts'
import { emptySessionSnapshot } from '../src/shared/agent-state.ts'

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function harness(t, { initializing = false } = {}) {
  const runtimes = []
  const mode = { value: 'request' }
  const directory = resolve('.tmp/session-process-fixture')
  const session = new SessionProcess(
    directory,
    directory,
    () => {},
    () => mode.value,
    () => null,
    {
      resolveTerminal: async () => ({ kind: 'powershell', path: 'powershell.exe' }),
      start: (event, failed) => {
        const gate = deferred()
        if (!initializing) gate.resolve()
        const runtime = {
          gate,
          event,
          failed,
          calls: [],
          stopped: 0,
          initialized: false,
          configure: undefined,
          async call(method, ...args) {
            this.calls.push({ method, args })
            if (method === 'initialize') {
              this.options = args[0]
              await gate.promise
              this.initialized = true
              const snapshot = emptySessionSnapshot(
                directory,
                args[0].sessionKey,
                args[0].sessionFile
              )
              snapshot.connection = 'ready'
              this.state = { snapshot, summary: null, persistedFile: args[0].sessionFile }
              return structuredClone(this.state)
            }
            if (!this.initialized) throw new Error('Runtime 尚未初始化')
            if (method === 'configure') return this.configure?.promise
            if (method === 'getSkills') return []
            return structuredClone(this.state)
          },
          async stop() {
            this.stopped++
            gate.reject(new Error('Runtime 已停止'))
          }
        }
        runtimes.push(runtime)
        return runtime
      }
    }
  )
  t.after(async () => {
    for (const runtime of runtimes) runtime.gate.resolve()
    await session.dispose()
  })
  return { session, runtimes, mode }
}

test('Skill 设置失效后，下一次技能列表和会话操作会重建 Runtime', async (t) => {
  const { session, runtimes } = harness(t)
  await session.load()
  session.invalidateSettings()
  await session.getSkills()
  assert.equal(runtimes[0].stopped, 1)
  assert.equal(runtimes.length, 2)
  assert.ok(runtimes[1].calls.some(({ method }) => method === 'getSkills'))
  session.invalidateSettings()
  await session.prompt('使用更新后的 Skill 设置')
  assert.equal(runtimes[1].stopped, 1)
  assert.equal(runtimes.length, 3)
  assert.ok(runtimes[2].calls.some(({ method }) => method === 'prompt'))
})

test('启动期间的审批挡位更新等待初始化，并应用最新选择', async (t) => {
  const { session, runtimes, mode } = harness(t, { initializing: true })
  const loading = session.load()
  void loading.catch(() => {})
  await nextTurn()
  mode.value = 'all'
  session.refreshApprovalMode()
  await nextTurn()
  assert.equal(runtimes[0].calls.filter(({ method }) => method === 'configure').length, 0)
  runtimes[0].gate.resolve()
  await loading
  await nextTurn()
  assert.deepEqual(runtimes[0].calls.find(({ method }) => method === 'configure').args, ['all'])
  assert.equal(session.snapshot.connection, 'ready')
})

test('旧 Runtime 的延迟配置失败不会关闭替换后的进程', async (t) => {
  const { session, runtimes } = harness(t)
  await session.load()
  runtimes[0].configure = deferred()
  session.refreshApprovalMode()
  await nextTurn()
  await session.stopClient()
  await session.load()
  runtimes[0].configure.reject(new Error('旧进程连接已断开'))
  await nextTurn()
  assert.equal(runtimes[1].stopped, 0)
  assert.equal(session.snapshot.connection, 'ready')
})

test('关闭正在初始化的会话会立即发起停止，而不是等待启动超时', async (t) => {
  const { session, runtimes } = harness(t, { initializing: true })
  const loading = session.load()
  const rejected = assert.rejects(loading, /停止|关闭/)
  await nextTurn()
  const closing = session.dispose()
  await nextTurn()
  try {
    assert.ok(runtimes[0].stopped > 0)
  } finally {
    runtimes[0].gate.reject(new Error('Runtime 已停止'))
    await Promise.all([closing, rejected])
  }
})
