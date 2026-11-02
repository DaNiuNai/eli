import test from 'node:test'
import assert from 'node:assert/strict'
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { AgentLibraryService } from '../src/runtime/library.ts'

const timestamp = new Date('2026-10-20T12:00:00Z').getTime()
const header = (id, time = timestamp) => ({
  type: 'session',
  id,
  version: 3,
  cwd: 'fixture-workspace',
  timestamp: new Date(time).toISOString()
})
const message = (id, role, content, time = timestamp) => ({
  type: 'message',
  id,
  timestamp: new Date(time).toISOString(),
  message: {
    role,
    content,
    timestamp: time,
    provider: 'fixture',
    model: 'local',
    ...(role === 'assistant' ? { usage: { input: 10, output: 5, cost: { total: 0.01 } } } : {})
  }
})
const jsonl = (entries) => entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n'

async function fixture(t) {
  const temporary = resolve('.tmp')
  await mkdir(temporary, { recursive: true })
  const directory = await mkdtemp(join(temporary, 'library-test-'))
  t.after(async () => {
    assert.ok(directory.startsWith(temporary + '\\') || directory.startsWith(temporary + '/'))
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  return { directory, library: new AgentLibraryService(directory) }
}

test('历史库只解析新增或变化的文件，保留未变化会话的引用并移除已删除会话', async (t) => {
  const { directory, library } = await fixture(t)
  const workspace = join(directory, 'workspace')
  await mkdir(join(workspace, 'subagents', 'parent'), { recursive: true })
  const paths = [join(directory, 'root.jsonl'), join(workspace, 'saved.jsonl')]
  await Promise.all(
    paths.map((path, index) =>
      writeFile(
        path,
        jsonl([header(String(index)), message(`user-${index}`, 'user', `任务 ${index}`)])
      )
    )
  )
  await writeFile(join(workspace, 'subagents', 'parent', 'child.jsonl'), jsonl([header('child')]))
  const read = t.mock.method(library, 'readFile')
  const first = await library.load(0)
  assert.equal(first.sessions.length, 2)
  assert.equal(read.mock.callCount(), 2)
  const second = await library.load(1)
  assert.equal(read.mock.callCount(), 2)
  assert.ok(second.sessions.every((session) => first.sessions.includes(session)))
  await appendFile(paths[1], jsonl([message('reply', 'assistant', '完成', timestamp + 1000)]))
  const third = await library.load(2)
  assert.equal(read.mock.callCount(), 3)
  assert.equal(third.sessions[0].path, paths[1])
  assert.equal(third.sessions[0].messageCount, 2)
  assert.equal(
    third.usage.reduce((total, record) => total + record.input + record.output, 0),
    15
  )
  assert.equal((await library.findSession(paths[0])).title, '任务 0')
  assert.equal(read.mock.callCount(), 3)
  await rm(paths[0])
  assert.deepEqual(
    (await library.load(3)).sessions.map((session) => session.path),
    [paths[1]]
  )
  await assert.rejects(library.findSession(paths[0]), /不在本机历史记录/)
})

test('单次解析兼容会话名称、文本块、分支用量去重与未写完记录的恢复', async (t) => {
  const { directory, library } = await fixture(t)
  const original = join(directory, 'original.jsonl')
  const fork = join(directory, 'fork.jsonl')
  const entries = [
    message('user', 'user', [
      { type: 'text', text: '第一行\n第二行' },
      { type: 'image', data: 'fixture' }
    ]),
    message('reply', 'assistant', '完成', timestamp + 1000)
  ]
  await writeFile(
    original,
    jsonl([header('original'), ...entries, { type: 'session_info', name: '命名会话' }])
  )
  await writeFile(fork, jsonl([header('fork', timestamp + 2000), ...entries]) + '{"type":')
  const first = await library.load()
  assert.equal(first.sessions.find((session) => session.path === original).title, '命名会话')
  assert.equal(first.sessions.find((session) => session.path === fork).title, '第一行 第二行')
  assert.equal(
    first.usage.reduce((sum, record) => sum + record.messages, 0),
    2
  )
  assert.equal(
    first.usage.reduce((sum, record) => sum + record.cost, 0),
    0.01
  )
  assert.ok(first.usage.every((record) => record.sessionPath === original))
  assert.equal(first.requests.length, 1)
  assert.equal(first.requests[0].sessionPath, original)
  assert.equal(first.requests[0].timestamp, timestamp + 1000)
  assert.equal(first.requests[0].stopReason, 'unknown')
  assert.match(first.warning, /1 个会话/)
  await appendFile(fork, '"session_info","name":""}\n')
  assert.equal((await library.load(1)).warning, null)
})

test('请求明细保留同一小时内的逐次用量、缓存与状态，缺少用量的失败记录沿用模型信息', async (t) => {
  const { directory, library } = await fixture(t)
  const path = join(directory, 'requests.jsonl')
  const success = message('success', 'assistant', '完成', timestamp)
  success.message.stopReason = 'stop'
  success.message.usage.cacheRead = 80
  success.message.usage.cacheWrite = 10
  const failure = message('failure', 'assistant', '', timestamp + 1000)
  failure.message.stopReason = 'error'
  delete failure.message.usage
  delete failure.message.provider
  delete failure.message.model
  const aborted = message('aborted', 'assistant', '', timestamp + 2000)
  aborted.message.stopReason = 'aborted'
  aborted.message.usage.input = -10
  aborted.message.usage.output = 'invalid'
  await writeFile(
    path,
    jsonl([
      header('requests'),
      { type: 'model_change', provider: 'fixture', modelId: 'local' },
      message('user', 'user', '请求测试'),
      success,
      failure,
      aborted
    ])
  )
  const result = await library.load()
  assert.equal(result.requests.length, 3)
  assert.deepEqual(
    result.requests.map((request) => request.stopReason),
    ['aborted', 'error', 'stop']
  )
  assert.equal(new Set(result.requests.map((request) => request.id)).size, 3)
  assert.ok(
    result.requests.every((request) => request.provider === 'fixture' && request.model === 'local')
  )
  assert.equal(result.requests[0].input, 0)
  assert.equal(result.requests[0].output, 0)
  assert.equal(result.requests[1].cost, 0)
  assert.equal(result.requests[2].cacheRead, 80)
  assert.equal(result.requests[2].cacheWrite, 10)
  assert.equal(
    result.usage.reduce((sum, record) => sum + record.requests, 0),
    3
  )
  assert.equal(
    result.usage.reduce((sum, record) => sum + record.cost, 0),
    result.requests.reduce((sum, request) => sum + request.cost, 0)
  )
})

test('刷新期间连续版本请求共用同一次工作，最多补读最新版本', async (t) => {
  const { library } = await fixture(t)
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const read = library.read.bind(library)
  let reads = 0
  t.mock.method(library, 'read', async () => {
    if (++reads === 1) await gate
    return read()
  })
  const first = library.load(0)
  const requests = Array.from({ length: 20 }, (_, index) => library.load(index + 1))
  assert.ok(requests.every((request) => request === first))
  release()
  const results = await Promise.all([first, ...requests])
  assert.equal(reads, 2)
  assert.ok(results.every((result) => result === results[0]))
})
