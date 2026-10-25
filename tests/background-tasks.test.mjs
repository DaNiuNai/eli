import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { BackgroundTasks } from '../src/runtime/background-tasks.ts'

async function fixture(t) {
  const temporary = resolve('.tmp')
  await mkdir(temporary, { recursive: true })
  const root = await mkdtemp(join(temporary, 'background-tasks-'))
  const managers = []
  const manager = (session = 'session') => {
    const tasks = new BackgroundTasks(root, session, () => {})
    managers.push(tasks)
    return tasks
  }
  t.after(async () => {
    await Promise.all(managers.map((tasks) => tasks.close()))
    assert.ok(root.startsWith(`${temporary}\\`) || root.startsWith(`${temporary}/`))
    await rm(root, { recursive: true, force: true })
  })
  return { root, manager }
}

function processStub() {
  let output, finish, signal
  let calls = 0
  return {
    operations: {
      exec: async (_command, _cwd, options) => {
        calls++
        output = options.onData
        signal = options.signal
        return new Promise((resolve, reject) => {
          finish = (code) => resolve({ exitCode: code })
          if (signal.aborted) reject(new Error('aborted'))
          else signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })
      }
    },
    write: (text) => output(Buffer.isBuffer(text) ? text : Buffer.from(text)),
    finish: (code = 0) => finish(code),
    get calls() {
      return calls
    },
    get signal() {
      return signal
    }
  }
}

const input = { command: 'test command', cwd: resolve('.tmp'), shell: 'fixture' }
async function until(predicate) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('任务状态等待超时')
}

test('显式后台执行立即返回句柄，原轮次取消不会终止任务，可读取增量与最终输出', async (t) => {
  const f = await fixture(t)
  const tasks = f.manager()
  const process = processStub()
  const turn = new AbortController()
  const task = await tasks.execute(process.operations, { ...input, background: true }, turn.signal)
  assert.equal(task.status, 'running')
  turn.abort()
  assert.equal(process.signal.aborted, false)
  const chinese = Buffer.from('后台输出')
  process.write(chinese.subarray(0, 2))
  process.write(chinese.subarray(2))
  assert.equal(tasks.get(task.id).output, '后台输出')
  process.finish()
  await until(() => tasks.get(task.id).status === 'completed')
  assert.equal(tasks.get(task.id).exitCode, 0)
  assert.equal(await readFile(task.logPath, 'utf8'), '后台输出')
  const restored = f.manager()
  assert.equal(restored.get(task.id).output, '后台输出')
  assert.equal(restored.get(task.id).status, 'completed')
  assert.throws(() => f.manager('other-session').get(task.id), /不存在/)
})

test('普通命令默认 30 秒转后台，快速命令直接返回结果，非零退出码为失败', async (t) => {
  const f = await fixture(t)
  const tasks = f.manager()
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const quick = {
    exec: async (_command, _cwd, { onData }) => {
      onData(Buffer.from('done'))
      return { exitCode: 7 }
    }
  }
  const result = await tasks.execute(quick, input)
  assert.equal(result.status, 'failed')
  assert.equal(result.exitCode, 7)
  assert.equal(result.output, 'done')
  const process = processStub()
  let returned = false
  const waiting = tasks.execute(process.operations, input).then((task) => {
    returned = true
    return task
  })
  t.mock.timers.tick(29999)
  await nextTurn()
  assert.equal(returned, false)
  t.mock.timers.tick(1)
  const task = await waiting
  assert.equal(task.status, 'running')
  process.finish()
})

test('前台等待时取消会停止进程；任务停止幂等并保留输出', async (t) => {
  const f = await fixture(t)
  const tasks = f.manager()
  const process = processStub()
  const turn = new AbortController()
  const waiting = tasks.execute(process.operations, input, turn.signal)
  await until(() => process.calls === 1)
  process.write('before cancellation')
  turn.abort()
  const task = await waiting
  assert.equal(task.status, 'cancelled')
  assert.equal(task.output, 'before cancellation')
  assert.equal(tasks.stop(task.id).status, 'cancelled')
  const other = processStub()
  const background = await tasks.execute(other.operations, { ...input, background: true })
  assert.equal(tasks.stop(background.id).status, 'stopping')
  await until(() => tasks.get(background.id).status === 'cancelled')
  assert.equal(other.signal.aborted, true)
})

test('超时、启动失败有独立状态；非法参数和关闭后请求不会启动进程', async (t) => {
  const f = await fixture(t)
  const tasks = f.manager()
  for (const [message, status] of [
    ['timeout:1', 'timed_out'],
    ['spawn ENOENT', 'failed']
  ]) {
    const task = await tasks.execute(
      {
        exec: async () => {
          throw new Error(message)
        }
      },
      input
    )
    assert.equal(task.status, status)
    assert.equal(task.error, message)
  }
  const process = processStub()
  for (const options of [{ timeout: -1 }, { yieldTimeMs: 30001 }, { command: '' }])
    await assert.rejects(tasks.execute(process.operations, { ...input, ...options }))
  await tasks.close()
  await assert.rejects(tasks.execute(process.operations, input), /已关闭/)
  assert.equal(process.calls, 0)
})

test('大输出限制内存和日志大小，关闭后任务状态持久化，异常退出记录恢复为中断', async (t) => {
  const f = await fixture(t)
  const tasks = f.manager()
  const process = processStub()
  const task = await tasks.execute(process.operations, { ...input, background: true })
  for (let i = 0; i < 11; i++) process.write(Buffer.alloc(1024 * 1024, 'x'))
  process.write('last output')
  const current = tasks.get(task.id)
  assert.ok(current.output.length <= 32768)
  assert.ok(current.output.endsWith('last output'))
  assert.equal(current.outputTruncated, true)
  assert.equal(current.logTruncated, true)
  assert.equal((await readFile(current.logPath)).length, 10 * 1024 * 1024)
  await tasks.close()
  assert.equal(f.manager().get(task.id).status, 'cancelled')
  const record = join(dirname(task.logPath), `${task.id}.json`)
  const saved = JSON.parse(await readFile(record, 'utf8'))
  await writeFile(record, JSON.stringify({ ...saved, status: 'running' }))
  assert.equal(f.manager().get(task.id).status, 'interrupted')
})

test('超过并发上限不会启动新命令，历史列表裁剪后仍可按句柄获取结果', async (t) => {
  const f = await fixture(t)
  const tasks = f.manager()
  const processes = Array.from({ length: 16 }, processStub)
  for (const process of processes)
    await tasks.execute(process.operations, { ...input, background: true })
  const rejected = processStub()
  await assert.rejects(tasks.execute(rejected.operations, input), /16/)
  assert.equal(rejected.calls, 0)
  for (const process of processes) process.finish()
  await until(() => tasks.list().every((task) => task.status === 'completed'))
  const first = tasks.list().at(-1)
  for (let i = 0; i < 101; i++) await tasks.execute({ exec: async () => ({ exitCode: 0 }) }, input)
  assert.equal(tasks.list().length, 100)
  assert.equal(tasks.get(first.id).status, 'completed')
  assert.equal(f.manager().list().length, 100)
})
