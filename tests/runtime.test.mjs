import test from 'node:test'
import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile, readFile, readdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { RuntimeConnection } from '../src/runtime/connection.ts'
import { RuntimeInteractions } from '../src/runtime/interactions.ts'
import { mcpHttpServer } from './fixtures/mcp-http.mjs'
import { mcpOAuthServer } from './fixtures/mcp-oauth.mjs'

const project = fileURLToPath(new URL('../', import.meta.url))
const temporaryRoot = join(project, '.tmp')
const cleanupByTest = new WeakMap()

async function fixture(t) {
  await mkdir(temporaryRoot, { recursive: true })
  const root = await mkdtemp(join(temporaryRoot, 'runtime-test-'))
  const data = join(root, 'home', '.eli')
  const cwd = join(root, 'workspace')
  await Promise.all([mkdir(data, { recursive: true }), mkdir(cwd, { recursive: true })])
  t.after(async () => {
    for (const close of cleanupByTest.get(t) ?? []) await close()
    assert.ok(
      resolve(root).startsWith(`${resolve(temporaryRoot)}\\`) ||
        resolve(root).startsWith(`${resolve(temporaryRoot)}/`)
    )
    await rm(root, { recursive: true, force: true })
  })
  return { root, data, cwd }
}

function runtime(t) {
  const child = fork(join(project, 'out/main/runtime.mjs'), [], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    execArgv: [],
    windowsHide: true
  })
  let stderr = ''
  child.stdout.resume()
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })
  const states = []
  const events = []
  const failures = []
  const connection = new RuntimeConnection(
    {
      send: (message) => child.send(message),
      kill: () => child.kill(),
      onMessage: (listener) => child.on('message', listener),
      onExit: (listener) =>
        child.on('exit', (code) => listener(new Error(`exit ${code}: ${stderr}`)))
    },
    (event) => {
      events.push(event)
      if (event.kind === 'session') states.push(event.state)
    },
    (error) => failures.push(error),
    20000
  )
  const close = async () => {
    await connection.stop()
    if (child.exitCode === null && child.signalCode === null)
      await new Promise((resolve) => child.once('exit', resolve))
  }
  const cleanups = cleanupByTest.get(t) ?? []
  cleanups.push(close)
  cleanupByTest.set(t, cleanups)
  t.after(close)
  return { child, connection, states, events, failures }
}

async function until(predicate, timeout = 10000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const result = predicate()
    if (result) return result
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('等待 Runtime 状态超时')
}

async function modelServer(t, data, review) {
  const requests = []
  const server = createServer(async (req, res) => {
    let text = ''
    for await (const chunk of req) text += chunk
    const body = JSON.parse(text)
    requests.push(body)
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const last = body.messages.at(-1)
    const user = body.messages.findLast((message) => message.role === 'user')
    const content = typeof user?.content === 'string' ? user.content : JSON.stringify(user?.content)
    const reviewing = JSON.stringify(body.messages[0]).includes('eli 的独立工具权限审核器')
    const repeated =
      content?.includes('REPEAT_TOOL') &&
      body.messages.filter((message) => message.role === 'tool').length < 3
    const tool =
      content?.includes('WRITE_TOOL') && (last.role !== 'tool' || repeated)
        ? 'write'
        : content?.includes('ASK_TOOL') && last.role !== 'tool'
          ? 'ask_user_question'
          : content?.includes('MCP_TOOL') && last.role !== 'tool'
            ? body.tools?.find(({ function: tool }) => tool.name === 'mcp__managed__echo')?.function
                .name
            : null
    const send = (delta, finish_reason = null) =>
      res.write(
        `data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 1, model: 'local', choices: [{ index: 0, delta, finish_reason }] })}\n\n`
      )
    send({ role: 'assistant', content: '' })
    if (reviewing) {
      const result = await review?.(body)
      send({
        content:
          typeof result === 'string'
            ? result
            : JSON.stringify(result ?? { decision: 'ask', reason: '测试需手动确认' })
      })
      send({}, 'stop')
      res.end('data: [DONE]\n\n')
      return
    }
    if (content?.includes('WAIT_FOREVER')) return
    if (tool) {
      const args =
        tool === 'write'
          ? { path: 'approved.txt', content: 'approved' }
          : tool === 'mcp__managed__echo'
            ? { value: 'runtime-approved' }
            : {
                questions: [
                  {
                    header: '选择',
                    question: '请选择',
                    multiSelect: false,
                    options: [
                      { label: '甲', description: '甲方案' },
                      { label: '乙', description: '乙方案' }
                    ]
                  }
                ]
              }
      const batch = content?.includes('BATCH_TOOLS') && tool === 'write'
      const toolCalls = Array.from({ length: batch ? 3 : 1 }, (_, index) => ({
        index,
        id: `call-local-${body.messages.filter((message) => message.role === 'tool').length + index}`,
        type: 'function',
        function: {
          name: tool,
          arguments: JSON.stringify(batch ? { ...args, path: `approved-${index}.txt` } : args)
        }
      }))
      if (batch && content.includes('ASK_BEFORE_BATCH')) {
        toolCalls.unshift({
          index: 0,
          id: 'call-question',
          type: 'function',
          function: {
            name: 'ask_user_question',
            arguments: JSON.stringify({
              questions: [
                {
                  header: '授权',
                  question: '是否创建这些文件？',
                  multiSelect: false,
                  options: [
                    { label: '创建', description: '允许创建' },
                    { label: '取消', description: '保持原样' }
                  ]
                }
              ]
            })
          }
        })
        toolCalls.forEach((call, index) => {
          call.index = index
        })
      }
      send({ tool_calls: toolCalls })
      send({}, 'tool_calls')
    } else {
      send({ content: `完成：${content ?? ''}` })
      send({}, 'stop')
    }
    res.end('data: [DONE]\n\n')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  const port = server.address().port
  await writeFile(
    join(data, 'config.json'),
    JSON.stringify({
      agent: {
        defaultProvider: 'eli-test',
        enabledModels: ['eli-test/*'],
        defaultModel: 'local',
        retry: { enabled: false },
        cacheWarming: 'off'
      },
      credentials: { 'api_key:eli-test': { type: 'api_key', key: 'test-only' } },
      ...(review ? { app: { autoApprovalModel: { provider: 'eli-test', id: 'reviewer' } } } : {}),
      providers: {
        'eli-test': {
          custom: true,
          api: 'openai-completions',
          baseUrl: `http://127.0.0.1:${port}/v1`,
          models: [
            ...(review
              ? [
                  {
                    id: 'reviewer',
                    name: 'Reviewer test',
                    reasoning: false,
                    vision: false,
                    contextWindow: 32768,
                    maxTokens: 4096
                  }
                ]
              : []),
            {
              id: 'local',
              name: 'Local test',
              reasoning: false,
              vision: true,
              contextWindow: 32768,
              maxTokens: 4096
            }
          ]
        }
      }
    })
  )
  return requests
}

async function initialize(
  connection,
  { data, cwd },
  key = '11111111-1111-4111-8111-111111111111',
  sessionFile,
  approvalMode = 'request'
) {
  return connection.call('initialize', {
    kind: 'session',
    root: data,
    cwd,
    sessionKey: key,
    sessionFile,
    approvalMode,
    terminal: { kind: 'powershell', path: 'powershell.exe' }
  })
}

test('MCP OAuth 经控制协议完成授权、发布状态并供聊天复用凭据', async (t) => {
  const f = await fixture(t)
  await modelServer(t, f.data)
  const oauth = await mcpOAuthServer(t)
  const control = runtime(t)
  await control.connection.call('initialize', {
    kind: 'control',
    root: f.data,
    cwd: f.cwd,
    firstLaunch: false
  })
  await control.connection.call('changeMcpServer', {
    action: 'create',
    name: 'managed',
    config: { url: oauth.url, exposure: 'direct' }
  })
  const probe = await control.connection.call('testMcpServer', 'managed')
  assert.equal(probe.authentication.method, 'oauth')
  assert.equal(
    await control.connection.call('getMcpWebsite', 'managed'),
    new URL('/docs/auth', oauth.url).href
  )
  await control.connection.call('startMcpAuth', 'managed')
  const pending = await until(
    () =>
      control.events.find((event) => event.kind === 'mcp_auth' && event.snapshot.authorizationUrl)
        ?.snapshot
  )
  assert.equal(
    await control.connection.call('validateMcpAuthLink', pending.id),
    pending.authorizationUrl
  )
  await fetch(pending.authorizationUrl)
  const authorized = await until(
    () =>
      control.events.find(
        (event) => event.kind === 'mcp_auth' && event.snapshot.status === 'success'
      )?.snapshot
  )
  assert.equal(authorized.result.status, 'connected')
  assert.equal((await control.connection.call('getMcpAuth')).status, 'success')
  await assert.rejects(control.connection.call('validateMcpAuthLink', pending.id), /失效/)
  const session = runtime(t)
  await initialize(session.connection, f)
  await session.connection.call('prompt', 'MCP_TOOL')
  const approval = await until(() =>
    session.states.find((state) => state.snapshot.toolApprovals.length)
  )
  await session.connection.call('approve', approval.snapshot.toolApprovals[0].id, true)
  await until(() =>
    session.states.find(
      (state) =>
        !state.snapshot.running &&
        state.snapshot.messages.some((message) => message.role === 'toolResult')
    )
  )
  assert.equal(oauth.calls.length, 1)
  assert.equal(oauth.exchanges(), 1)
  assert.equal(JSON.stringify(control.events).includes('eli-mcp-test-access-token'), false)
  assert.equal(
    (await control.connection.call('getMcpServers'))[0].authentication.state,
    'authenticated'
  )
  await session.connection.stop()
  await control.connection.call('startMcpAuth', 'managed', true)
  const again = await until(
    () =>
      control.events.find(
        (event) =>
          event.kind === 'mcp_auth' &&
          event.snapshot.authorizationUrl &&
          event.snapshot.id !== pending.id
      )?.snapshot
  )
  await fetch(again.authorizationUrl)
  await until(() =>
    control.events.find(
      (event) =>
        event.kind === 'mcp_auth' &&
        event.snapshot.id === again.id &&
        event.snapshot.status === 'success'
    )
  )
  assert.equal(oauth.exchanges(), 2)
  const signedOut = await control.connection.call('signOutMcpAuth', 'managed')
  assert.equal(signedOut[0].authentication.state, 'unauthenticated')
  assert.equal(signedOut[0].config.url, oauth.url)
  assert.equal((await control.connection.call('getMcpAuth')).status, 'signed-out')
  assert.equal((await control.connection.call('testMcpServer', 'managed')).status, 'needs-auth')
})

for (const transport of ['stdio', 'http']) {
  test(`MCP ${transport} 管理经 Runtime 协议接入聊天，调用前审批并在停用后移除`, async (t) => {
    const f = await fixture(t)
    const modelRequests = await modelServer(t, f.data)
    const http = transport === 'http' ? await mcpHttpServer(t, { requireAuth: true }) : null
    const log = join(f.root, 'mcp-stdio.log')
    const config = {
      ...(http
        ? { type: 'http', url: http.url, headers: { Authorization: 'Bearer mcp-test-only' } }
        : {
            type: 'stdio',
            command: process.execPath,
            args: [resolve('tests/fixtures/mcp-stdio.mjs'), log]
          }),
      exposure: 'direct'
    }
    const calls = async () =>
      http
        ? http.requests.filter(({ method }) => method === 'tools/call')
        : (await readFile(log, 'utf8'))
            .trim()
            .split('\n')
            .map(JSON.parse)
            .filter(({ method }) => method === 'tools/call')
    const control = runtime(t)
    await control.connection.call('initialize', {
      kind: 'control',
      root: f.data,
      cwd: f.cwd,
      firstLaunch: false
    })
    assert.deepEqual(await control.connection.call('getMcpServers'), [])
    const servers = await control.connection.call('changeMcpServer', {
      action: 'create',
      name: 'managed',
      config
    })
    assert.equal(servers[0].name, 'managed')
    assert.equal((await control.connection.call('testMcpServer', 'managed')).status, 'connected')
    assert.equal((await calls()).length, 0)
    const session = runtime(t)
    await initialize(session.connection, f)
    await session.connection.call('prompt', 'MCP_TOOL')
    const pending = await until(() =>
      session.states.find((state) => state.snapshot.toolApprovals.length)
    )
    assert.equal(pending.snapshot.toolApprovals[0].toolName, 'mcp__managed__echo')
    assert.equal((await calls()).length, 0)
    await session.connection.call('approve', pending.snapshot.toolApprovals[0].id, true)
    const completed = await until(() =>
      session.states.find(
        (state) =>
          !state.snapshot.running &&
          state.snapshot.messages.some((message) => message.role === 'toolResult')
      )
    )
    assert.ok(JSON.stringify(completed).includes('mcp-echo:runtime-approved'))
    assert.equal((await calls()).length, 1)
    assert.ok(
      modelRequests.some((body) =>
        body.tools?.some(({ function: tool }) => tool.name === 'mcp__managed__echo')
      )
    )
    await session.connection.stop()
    await control.connection.call('changeMcpServer', {
      action: 'setEnabled',
      name: 'managed',
      enabled: false
    })
    const disabled = runtime(t)
    await initialize(disabled.connection, f, '22222222-2222-4222-8222-222222222222')
    const before = modelRequests.length
    await disabled.connection.call('prompt', 'MCP_TOOL')
    await until(() =>
      disabled.states.find(
        (state) => !state.snapshot.running && state.snapshot.messages.length >= 2
      )
    )
    assert.ok(
      modelRequests
        .slice(before)
        .every(
          (body) => !body.tools?.some(({ function: tool }) => tool.name === 'mcp__managed__echo')
        )
    )
    assert.equal((await calls()).length, 1)
    await disabled.connection.stop()
    const current = (await control.connection.call('getMcpServers'))[0]
    await control.connection.call('changeMcpServer', {
      action: 'delete',
      name: current.name,
      expected: current.config
    })
    assert.deepEqual(await control.connection.call('getMcpServers'), [])
  })
}

test('权限等待支持拒绝、模式切换、取消与跨会话隔离', async () => {
  const first = new RuntimeInteractions('request', () => {})
  const second = new RuntimeInteractions('request', () => {})
  const request = { toolCallId: 'tool', toolName: 'write', input: { path: 'a' } }
  const waiting = first.approve(request, false)
  const id = first.toolApprovals[0].id
  assert.throws(() => second.respondApproval(id, true), /失效/)
  first.respondApproval(id, false)
  assert.deepEqual(await waiting, { approved: false, terminate: true })
  const pending = first.approve(request, false)
  first.setMode('edit')
  assert.deepEqual(await pending, { approved: true })
  first.setMode('request')
  const controller = new AbortController()
  const aborted = first.approve(request, false, controller.signal)
  controller.abort()
  assert.deepEqual(await aborted, { approved: false, terminate: true })
  assert.equal(first.toolApprovals.length, 0)
})

test('自动批准使用独立模型，真实写入通过审核后执行', async (t) => {
  const paths = await fixture(t)
  const requests = await modelServer(t, paths.data, () => ({
    decision: 'allow',
    reason: '用户要求写入项目文件'
  }))
  const session = runtime(t)
  await initialize(session.connection, paths)
  await session.connection.call('configure', 'auto')
  await session.connection.call('prompt', 'WRITE_TOOL 请创建 approved.txt')
  await until(() =>
    session.states.findLast(
      (state) => !state.snapshot.running && state.snapshot.messages.length >= 4
    )
  )
  assert.equal(await readFile(join(paths.cwd, 'approved.txt'), 'utf8'), 'approved')
  const review = requests.find((body) => body.model === 'reviewer')
  assert.ok(review)
  assert.ok(!review.tools?.length)
  const context = JSON.parse(review.messages.find((message) => message.role === 'user').content)
  assert.ok(
    context.history.some(
      (message) => message.role === 'user' && message.content.includes('WRITE_TOOL')
    )
  )
  assert.equal(context.pendingTool.toolName, 'write')
  assert.ok(requests.filter((body) => body.model === 'local').length >= 2)
  assert.ok(session.states.every((state) => state.snapshot.toolApprovals.length === 0))
})

test('同轮工具并行审核，乱序返回与人工确认仍对应各自调用', async (t) => {
  const paths = await fixture(t)
  const reviews = new Map()
  await modelServer(t, paths.data, (body) => {
    const context = JSON.parse(body.messages.find((message) => message.role === 'user').content)
    return new Promise((resolve) => reviews.set(context.pendingTool.input.path, resolve))
  })
  const session = runtime(t)
  await initialize(session.connection, paths, undefined, undefined, 'auto')
  await session.connection.call('prompt', 'WRITE_TOOL BATCH_TOOLS 请创建三个文件')
  await until(() => reviews.size === 3)
  await until(() => session.states.findLast((state) => state.snapshot.autoApproval.reviewing === 3))
  for (let i = 0; i < 3; i++)
    await assert.rejects(readFile(join(paths.cwd, `approved-${i}.txt`)), { code: 'ENOENT' })

  reviews.get('approved-2.txt')({ decision: 'deny', reason: '第三个文件未授权' })
  reviews.get('approved-1.txt')({ decision: 'ask', reason: '第二个文件需要确认' })
  reviews.get('approved-0.txt')({ decision: 'allow', reason: '第一个文件已授权' })
  const pending = await until(() =>
    session.states.findLast((state) => state.snapshot.toolApprovals.length === 1)
  )
  const [manual] = pending.snapshot.toolApprovals
  assert.equal(manual.input.path, 'approved-1.txt')
  assert.match(manual.reason, /第二个文件需要确认/)
  await assert.rejects(readFile(join(paths.cwd, 'approved-0.txt')), { code: 'ENOENT' })
  await session.connection.call('approve', manual.id, true)
  const completed = await until(() =>
    session.states.findLast(
      (state) => !state.snapshot.running && state.snapshot.messages.length >= 6
    )
  )
  for (let i = 0; i < 2; i++)
    assert.equal(await readFile(join(paths.cwd, `approved-${i}.txt`), 'utf8'), 'approved')
  await assert.rejects(readFile(join(paths.cwd, 'approved-2.txt')), { code: 'ENOENT' })
  const results = completed.snapshot.messages.filter((message) => message.role === 'toolResult')
  assert.deepEqual(
    results.map((message) => message.toolCallId),
    ['call-local-0', 'call-local-1', 'call-local-2']
  )
  assert.deepEqual(
    results.map((message) => !!message.isError),
    [false, false, true]
  )
})

test('停止同轮并行审核会取消全部等待，迟到的允许不能执行工具', async (t) => {
  const paths = await fixture(t)
  const reviews = []
  await modelServer(t, paths.data, () => new Promise((resolve) => reviews.push(resolve)))
  const session = runtime(t)
  await initialize(session.connection, paths, undefined, undefined, 'auto')
  await session.connection.call('prompt', 'WRITE_TOOL BATCH_TOOLS 请创建三个文件')
  await until(() => reviews.length === 3)
  await session.connection.call('abort')
  for (const finish of reviews) finish({ decision: 'allow', reason: '迟到的审核结果' })
  const stopped = await until(() =>
    session.states.findLast(
      (state) => !state.snapshot.running && state.snapshot.autoApproval.reviewing === 0
    )
  )
  assert.equal(stopped.snapshot.toolApprovals.length, 0)
  for (let i = 0; i < 3; i++)
    await assert.rejects(readFile(join(paths.cwd, `approved-${i}.txt`)), { code: 'ENOENT' })
  const tools = Object.values(stopped.snapshot.tools)
  assert.equal(tools.length, 1)
  assert.ok(tools.every((event) => event.type === 'tool_execution_end'))
})

test('显式串行工具保持顺序，用户答复之前不会提前审核后续调用', async (t) => {
  const paths = await fixture(t)
  let reviews = 0
  const requests = await modelServer(t, paths.data, (body) => {
    reviews++
    const context = JSON.parse(body.messages.find((message) => message.role === 'user').content)
    assert.ok(context.history.some((entry) => entry.role === 'user_answer'))
    return { decision: 'allow', reason: '用户已确认创建' }
  })
  const session = runtime(t)
  await initialize(session.connection, paths, undefined, undefined, 'auto')
  await session.connection.call('prompt', 'WRITE_TOOL BATCH_TOOLS ASK_BEFORE_BATCH')
  const pending = await until(() =>
    session.states.findLast((state) => state.snapshot.userQuestions.length)
  )
  assert.equal(reviews, 0)
  assert.equal(requests.filter((body) => body.model === 'reviewer').length, 0)
  await session.connection.call('answer', pending.snapshot.userQuestions[0].id, [
    { selectedOptions: [0] }
  ])
  await until(() =>
    session.states.findLast(
      (state) => !state.snapshot.running && state.snapshot.messages.length >= 7
    )
  )
  assert.equal(reviews, 3)
  for (let i = 0; i < 3; i++)
    assert.equal(await readFile(join(paths.cwd, `approved-${i}.txt`), 'utf8'), 'approved')
})

test('自动拒绝返回原因供 Agent 继续，连续三次后人工接管', async (t) => {
  const paths = await fixture(t)
  let count = 0
  const requests = await modelServer(t, paths.data, () => {
    count++
    return { decision: 'deny', reason: '测试：超出授权范围' }
  })
  const session = runtime(t)
  await initialize(session.connection, paths)
  await session.connection.call('configure', 'auto')
  await session.connection.call('prompt', 'WRITE_TOOL REPEAT_TOOL')
  const pending = await until(() =>
    session.states.findLast(
      (state) => state.snapshot.autoApproval.paused && state.snapshot.toolApprovals.length
    )
  )
  assert.equal(count, 3)
  await assert.rejects(readFile(join(paths.cwd, 'approved.txt')), { code: 'ENOENT' })
  assert.ok(
    requests
      .filter((body) => body.model === 'local')
      .some((body) =>
        body.messages.some(
          (message) =>
            message.role === 'tool' && JSON.stringify(message.content).includes('超出授权范围')
        )
      )
  )
  await session.connection.call('approve', pending.snapshot.toolApprovals[0].id, true)
  const completed = await until(() =>
    session.states.findLast(
      (state) => !state.snapshot.running && state.snapshot.messages.length >= 8
    )
  )
  assert.equal(await readFile(join(paths.cwd, 'approved.txt'), 'utf8'), 'approved')
  await session.connection.stop()
  const reopened = runtime(t)
  const restored = await initialize(
    reopened.connection,
    paths,
    'restored-auto',
    completed.persistedFile,
    'auto'
  )
  assert.equal(restored.snapshot.autoApproval.paused, true)
  await reopened.connection.call('prompt', 'WRITE_TOOL')
  const manual = await until(() =>
    reopened.states.findLast((state) => state.snapshot.toolApprovals.length)
  )
  assert.equal(count, 3, '恢复后仍应等待人工审批')
  await reopened.connection.call('approve', manual.snapshot.toolApprovals[0].id, false)
  await until(() => reopened.states.findLast((state) => !state.snapshot.running))
  await reopened.connection.call('configure', 'request')
  await reopened.connection.call('configure', 'auto')
  await reopened.connection.stop()
  const resumed = runtime(t)
  const ready = await initialize(
    resumed.connection,
    paths,
    'resumed-auto',
    completed.persistedFile,
    'auto'
  )
  assert.equal(ready.snapshot.autoApproval.paused, false)
})

test('审核返回 ask 或无效响应均回退人工，用户拒绝结束本轮', async (t) => {
  const paths = await fixture(t)
  let result = 'invalid classifier response'
  await modelServer(t, paths.data, () => result)
  const session = runtime(t)
  await initialize(session.connection, paths)
  await session.connection.call('configure', 'auto')
  for (let i = 0; i < 2; i++) {
    session.states.length = 0
    await session.connection.call('prompt', 'WRITE_TOOL')
    const pending = await until(() =>
      session.states.findLast((state) => state.snapshot.toolApprovals.length)
    )
    assert.match(pending.snapshot.toolApprovals[0].reason, i === 0 ? /格式无效/ : /请明确目标/)
    await session.connection.call('approve', pending.snapshot.toolApprovals[0].id, false)
    await until(() => session.states.findLast((state) => !state.snapshot.running))
    await assert.rejects(readFile(join(paths.cwd, 'approved.txt')), { code: 'ENOENT' })
    result = JSON.stringify({ decision: 'ask', reason: '请明确目标' })
  }
})

test('审核模型设置持久化，修改后下一次审核生效；不可用模型不静默替换', async (t) => {
  const paths = await fixture(t)
  const requests = await modelServer(t, paths.data, () => ({
    decision: 'allow',
    reason: '测试允许'
  }))
  const session = runtime(t)
  await initialize(session.connection, paths)
  await session.connection.call('configure', 'auto')
  const file = join(paths.data, 'config.json')
  const config = JSON.parse(await readFile(file, 'utf8'))
  config.app.autoApprovalModel.id = 'missing-reviewer'
  await writeFile(file, JSON.stringify(config))
  await session.connection.call('prompt', 'WRITE_TOOL')
  const pending = await until(() =>
    session.states.findLast((state) => state.snapshot.toolApprovals.length)
  )
  assert.match(pending.snapshot.toolApprovals[0].reason, /模型不可用/)
  assert.ok(!requests.some((body) => body.model === 'reviewer'))
  await session.connection.call('approve', pending.snapshot.toolApprovals[0].id, false)
  await until(() => session.states.findLast((state) => !state.snapshot.running))
  config.app.autoApprovalModel = null
  await writeFile(file, JSON.stringify(config))
  session.states.length = 0
  await session.connection.call('prompt', 'WRITE_TOOL')
  await until(() => session.states.findLast((state) => !state.snapshot.running))
  assert.equal(await readFile(join(paths.cwd, 'approved.txt'), 'utf8'), 'approved')
  assert.ok(
    requests.some(
      (body) =>
        body.model === 'local' &&
        JSON.stringify(body.messages[0]).includes('eli 的独立工具权限审核器')
    )
  )
})

test('协议错误与超时会关闭通道并拒绝所有待处理请求', async () => {
  let receive
  let killed = 0
  const transport = {
    send: () => {},
    kill: () => killed++,
    onMessage: (listener) => {
      receive = listener
    },
    onExit: () => {}
  }
  const invalid = new RuntimeConnection(
    transport,
    () => {},
    () => {},
    100
  )
  receive(null)
  await assert.rejects(invalid.ready, /无效消息/)
  assert.equal(killed, 1)
  const timedOut = new RuntimeConnection(
    transport,
    () => {},
    () => {},
    20
  )
  receive({ version: 1, kind: 'ready' })
  await assert.rejects(timedOut.call('getSettings'), /超时/)
  await assert.rejects(timedOut.call('getLibrary'), /超时/)
  assert.equal(killed, 2)
})

test('独立进程启动、空白会话与 eli 配置隔离', async (t) => {
  const fixtureData = await fixture(t)
  await modelServer(t, fixtureData.data)
  await mkdir(join(fixtureData.cwd, '.pi'), { recursive: true })
  await writeFile(join(fixtureData.cwd, '.pi/settings.json'), '{ invalid old settings')
  const { connection, child } = runtime(t)
  const state = await initialize(connection, fixtureData)
  assert.notEqual(child.pid, process.pid)
  assert.equal(state.snapshot.connection, 'ready')
  assert.equal(state.snapshot.model.provider, 'eli-test')
  assert.equal(state.persistedFile, undefined)
  assert.equal(state.summary, null)
  assert.ok(state.snapshot.session.sessionFile.startsWith(join(fixtureData.data, 'sessions')))
})

test('未配置 eli 凭据时不会借用环境凭据，也不会把正常空白页显示为错误', async (t) => {
  const f = await fixture(t)
  const r = runtime(t)
  const state = await initialize(r.connection, f)
  assert.equal(state.snapshot.model, null)
  assert.deepEqual(state.snapshot.models, [])
  assert.equal(state.snapshot.error, null)
  await assert.rejects(r.connection.call('prompt', 'must not reach any provider'), /配置模型/)
})

test('默认模型在启用范围内选择，项目扩展注册的模型也参与选择', async (t) => {
  const f = await fixture(t)
  await modelServer(t, f.data)
  const config = JSON.parse(await readFile(join(f.data, 'config.json'), 'utf8'))
  const pref = config.providers['eli-test']
  pref.models.push({ ...pref.models[0], id: 'outside' })
  const provider = {
    api: pref.api,
    baseUrl: pref.baseUrl,
    apiKey: 'test-only',
    models: pref.models.map(({ vision, ...model }) => ({
      ...model,
      input: vision ? ['text', 'image'] : ['text']
    }))
  }
  config.agent.defaultModel = 'outside'
  config.agent.enabledModels = ['eli-test/local']
  await writeFile(join(f.data, 'config.json'), JSON.stringify(config))
  const first = runtime(t)
  assert.equal((await initialize(first.connection, f)).snapshot.model.id, 'local')
  await first.connection.call('setModel', 'eli-test', 'local')
  await first.connection.call('setThinkingLevel', 'off')
  const savedConfig = JSON.parse(await readFile(join(f.data, 'config.json'), 'utf8'))
  assert.equal(savedConfig.agent.defaultModel, 'local')
  assert.equal(savedConfig.agent.defaultProvider, 'eli-test')
  assert.equal(savedConfig.agent.defaultThinkingLevel, 'off')
  await first.connection.stop()
  await mkdir(join(f.cwd, '.eli/extensions'), { recursive: true })
  await writeFile(
    join(f.cwd, '.eli/extensions/provider.ts'),
    `export default function(pi) { pi.registerProvider('eli-extension', ${JSON.stringify(provider)}) }`
  )
  config.agent.defaultProvider = 'eli-extension'
  config.agent.enabledModels = ['eli-extension/local']
  await writeFile(join(f.data, 'config.json'), JSON.stringify(config))
  const second = runtime(t)
  const loaded = await initialize(second.connection, f)
  assert.equal(loaded.snapshot.model.provider, 'eli-extension')
  assert.equal(loaded.snapshot.model.id, 'local')
  assert.deepEqual(
    loaded.snapshot.models.map(({ provider }) => provider),
    ['eli-extension']
  )
})

test('真实 SDK 流式回复、历史恢复、编辑和分叉', async (t) => {
  const f = await fixture(t)
  const requests = await modelServer(t, f.data)
  const first = runtime(t)
  await initialize(first.connection, f)
  await first.connection.call('prompt', '第一条')
  const finished = await until(() =>
    first.states.findLast(
      (state) =>
        !state.snapshot.running &&
        state.snapshot.messages.some((message) => message.role === 'assistant')
    )
  )
  const systemPrompt = requests[0].messages.find((message) => message.role === 'system').content
  assert.match(systemPrompt, /expert coding assistant operating inside pi/)
  assert.match(
    systemPrompt,
    /<tools>[\s\S]*- powershell: Execute PowerShell commands[\s\S]*<\/tools>/
  )
  assert.match(
    systemPrompt,
    /<rules>[\s\S]*Use write only for new files or complete rewrites\.[\s\S]*<\/rules>/
  )
  assert.match(systemPrompt, /<docs>[\s\S]*Pi documentation[\s\S]*<\/docs>/)
  assert.equal(finished.snapshot.error, null)
  assert.equal(
    finished.snapshot.messages.findLast((message) => message.role === 'assistant').stopReason,
    'stop'
  )
  assert.ok(finished.persistedFile)
  const assistantIndex = finished.snapshot.messages.findIndex(
    (message) => message.role === 'assistant'
  )
  const assistantEntry = finished.snapshot.messageEntryIds[assistantIndex]
  assert.ok(assistantEntry)
  const forkPath = await first.connection.call('forkMessage', {
    sessionId: finished.snapshot.session.sessionId,
    entryId: assistantEntry
  })
  assert.notEqual(forkPath, finished.persistedFile)
  const userIndex = finished.snapshot.messages.findIndex((message) => message.role === 'user')
  await first.connection.call(
    'editMessage',
    {
      sessionId: finished.snapshot.session.sessionId,
      entryId: finished.snapshot.messageEntryIds[userIndex]
    },
    '修改后的消息'
  )
  const edited = await until(() =>
    first.states.findLast(
      (state) =>
        !state.snapshot.running &&
        state.snapshot.messages.some(
          (message) =>
            message.role === 'user' &&
            message.content.some?.((part) => part.text === '修改后的消息')
        )
    )
  )
  assert.equal(edited.snapshot.messages.filter((message) => message.role === 'user').length, 1)
  await first.connection.stop()
  const restored = runtime(t)
  const loaded = await initialize(
    restored.connection,
    f,
    '22222222-2222-4222-8222-222222222222',
    finished.persistedFile
  )
  assert.equal(loaded.snapshot.session.sessionId, finished.snapshot.session.sessionId)
  assert.deepEqual(loaded.snapshot.messages, edited.snapshot.messages)
  const forked = runtime(t)
  const forkState = await initialize(
    forked.connection,
    f,
    '33333333-3333-4333-8333-333333333333',
    forkPath
  )
  assert.notEqual(forkState.snapshot.session.sessionId, finished.snapshot.session.sessionId)
  assert.equal(forkState.snapshot.messages.length, finished.snapshot.messages.length)
})

test('真实工具审批、提问和中止不会跨会话放行', async (t) => {
  const f = await fixture(t)
  await modelServer(t, f.data)
  const first = runtime(t)
  await initialize(first.connection, f)
  await first.connection.call('prompt', 'WRITE_TOOL')
  const pending = await until(() =>
    first.states.findLast((state) => state.snapshot.toolApprovals.length)
  ).catch((error) => {
    t.diagnostic(
      JSON.stringify(
        first.states.at(-1)?.snapshot.messages.filter((message) => message.role === 'assistant')
      )
    )
    throw error
  })
  const approval = pending.snapshot.toolApprovals[0]
  assert.ok(pending.snapshot.contextUsage?.tokens > 0, '等待工具审批时应已更新本轮上下文用量')
  await assert.rejects(readFile(join(f.cwd, 'approved.txt')), { code: 'ENOENT' })
  await first.connection.call('approve', approval.id, true)
  await until(() =>
    first.states.findLast(
      (state) =>
        !state.snapshot.running &&
        state.snapshot.messages.some((message) => message.role === 'toolResult')
    )
  )
  assert.equal(await readFile(join(f.cwd, 'approved.txt'), 'utf8'), 'approved')
  first.states.length = 0
  await first.connection.call('prompt', 'ASK_TOOL')
  const asking = await until(() =>
    first.states.findLast((state) => state.snapshot.userQuestions.length)
  )
  await first.connection.call('answer', asking.snapshot.userQuestions[0].id, [
    { selectedOptions: [1] }
  ])
  await until(() => first.states.findLast((state) => !state.snapshot.running))
  first.states.length = 0
  await first.connection.call('prompt', 'WRITE_TOOL')
  const again = await until(() =>
    first.states.findLast((state) => state.snapshot.toolApprovals.length)
  )
  await first.connection.call('abort')
  await assert.rejects(
    first.connection.call('approve', again.snapshot.toolApprovals[0].id, true),
    /失效/
  )
  first.states.length = 0
  await first.connection.call('prompt', 'WAIT_FOREVER')
  await first.connection.call('abort')
  const aborted = await until(() => first.states.findLast((state) => !state.snapshot.running))
  assert.equal(aborted.snapshot.activity, '已停止')
})

test('管理进程只索引 ~/.eli 会话，设置按字段持久化', async (t) => {
  const f = await fixture(t)
  const { connection } = runtime(t)
  await connection.call('initialize', {
    kind: 'control',
    root: f.data,
    cwd: f.cwd,
    firstLaunch: true
  })
  assert.deepEqual((await connection.call('getLibrary')).sessions, [])
  const settings = await connection.call('saveSettings', [
    { key: 'defaultThinkingLevel', value: 'high' }
  ])
  assert.equal(settings.values.defaultThinkingLevel, 'high')
  await assert.rejects(
    connection.call('saveSettings', [{ key: 'defaultThinkingLevel', value: 'low' }]),
    /其他操作/
  )
  await assert.rejects(
    connection.call('saveSettings', [{ key: 'sessionDir', value: '../old' }]),
    /无效的设置项/
  )
  const files = await readdir(f.data)
  assert.ok(files.includes('config.json'))
  assert.equal(files.includes('settings.json'), false)
  assert.equal(
    JSON.parse(await readFile(join(f.data, 'config.json'), 'utf8')).agent.defaultThinkingLevel,
    'high'
  )
})

test('重启后从工作目录子目录发现历史会话并恢复完整消息', async (t) => {
  const f = await fixture(t)
  await modelServer(t, f.data)
  const controlOptions = { kind: 'control', root: f.data, cwd: f.cwd, firstLaunch: false }
  const originalControl = runtime(t)
  await originalControl.connection.call('initialize', controlOptions)
  assert.deepEqual((await originalControl.connection.call('getLibrary')).sessions, [])

  const saved = []
  for (const [index, cwd] of [f.cwd, join(f.root, '另一个工作目录')].entries()) {
    await mkdir(cwd, { recursive: true })
    const session = runtime(t)
    await initialize(session.connection, { ...f, cwd }, `history-session-${index}`)
    const title = `重启后保留的对话 ${index + 1}`
    await session.connection.call('prompt', title)
    const finished = await until(() =>
      session.states.findLast(
        (state) =>
          !state.snapshot.running &&
          state.snapshot.messages.some((message) => message.role === 'assistant')
      )
    )
    assert.equal(finished.snapshot.error, null)
    assert.ok(finished.persistedFile)
    saved.push({ ...finished, title, cwd })
    await session.connection.stop()
  }
  await originalControl.connection.stop()

  const restartedControl = runtime(t)
  await restartedControl.connection.call('initialize', controlOptions)
  const library = await restartedControl.connection.call('getLibrary')
  assert.deepEqual(
    new Set(library.sessions.map((session) => session.path)),
    new Set(saved.map((session) => session.persistedFile))
  )
  assert.equal(library.warning, null)
  assert.equal(
    library.usage.reduce((total, record) => total + record.messages, 0),
    4
  )

  for (const expected of saved) {
    const discovered = await restartedControl.connection.call('findSession', expected.persistedFile)
    assert.equal(discovered.id, expected.snapshot.session.sessionId)
    assert.equal(discovered.cwd, expected.cwd)
    assert.equal(discovered.title, expected.title)
    assert.equal(discovered.messageCount, expected.snapshot.messages.length)
    assert.equal(await restartedControl.connection.call('hasWorkspace', expected.cwd), true)
    const reopened = runtime(t)
    const loaded = await initialize(
      reopened.connection,
      { ...f, cwd: discovered.cwd },
      `reopened-${discovered.id}`,
      discovered.path
    )
    assert.equal(loaded.snapshot.session.sessionId, discovered.id)
    assert.deepEqual(loaded.snapshot.messages, expected.snapshot.messages)
    await reopened.connection.stop()
  }
})

test('进程崩溃立即使待处理请求失败', async (t) => {
  const f = await fixture(t)
  const { connection, child, failures } = runtime(t)
  await connection.call('initialize', {
    kind: 'control',
    root: f.data,
    cwd: f.cwd,
    firstLaunch: true
  })
  child.kill()
  await until(() => failures.length)
  await assert.rejects(connection.call('getSettings'), /exit/)
})

test('说明文件保留默认加载顺序，追加自定义文件并去重，清空配置后恢复默认', async (t) => {
  const f = await fixture(t)
  const requests = await modelServer(t, f.data)
  await mkdir(join(f.cwd, '.eli'), { recursive: true })
  await mkdir(join(f.data, 'rules'), { recursive: true })
  const defaults = [
    [join(f.data, 'AGENTS.md'), 'ELI_GLOBAL_INSTRUCTION'],
    [join(f.root, 'AGENTS.md'), 'ELI_ANCESTOR_INSTRUCTION'],
    [join(f.cwd, 'AGENTS.md'), 'ELI_WORKSPACE_INSTRUCTION'],
    [join(f.cwd, '.eli', 'AGENTS.md'), 'ELI_PROJECT_INSTRUCTION']
  ]
  const custom = [
    [join(f.root, 'absolute rules.md'), 'ELI_ABSOLUTE_INSTRUCTION'],
    [join(f.data, 'rules/team.md'), 'ELI_RELATIVE_INSTRUCTION']
  ]
  for (const [path, content] of [...defaults, ...custom]) await writeFile(path, content)
  const paths = [
    custom[0][0],
    'rules/team.md',
    join(f.data, 'rules/../rules/team.md'),
    ...(process.platform === 'win32' ? [custom[0][0].toUpperCase()] : []),
    defaults[0][0],
    defaults[3][0],
    'rules/missing.md'
  ]
  const control = runtime(t)
  await control.connection.call('initialize', {
    kind: 'control',
    root: f.data,
    cwd: f.cwd,
    firstLaunch: false
  })
  const saved = await control.connection.call('saveSettings', [
    { key: 'agentsFiles', value: paths }
  ])
  assert.deepEqual(saved.values.agentsFiles, paths)
  const before = await readFile(join(f.data, 'config.json'), 'utf8')
  const session = runtime(t)
  await initialize(session.connection, f)
  await session.connection.call('prompt', '检查说明文件')
  await until(() =>
    session.states.some(
      (state) =>
        !state.snapshot.running &&
        state.snapshot.messages.some((message) => message.role === 'assistant')
    )
  )
  const prompt = requests[0].messages.find(({ role }) => role === 'system').content
  let previous = -1
  for (const [, content] of [...defaults, ...custom]) {
    assert.equal(prompt.split(content).length - 1, 1, `${content} must be loaded once`)
    const index = prompt.indexOf(content)
    assert.ok(index > previous, `${content} must follow the configured order`)
    previous = index
  }
  assert.equal(await readFile(join(f.data, 'config.json'), 'utf8'), before)
  await session.connection.stop()
  await control.connection.call('saveSettings', [
    { key: 'agentsFiles', value: [], expected: paths }
  ])
  const fallback = runtime(t)
  await initialize(fallback.connection, f, 'default-instructions')
  await fallback.connection.call('prompt', '检查默认说明')
  await until(() =>
    fallback.states.some(
      (state) =>
        !state.snapshot.running &&
        state.snapshot.messages.some((message) => message.role === 'assistant')
    )
  )
  const defaultPrompt = requests.at(-1).messages.find(({ role }) => role === 'system').content
  for (const [, content] of defaults) assert.ok(defaultPrompt.includes(content))
  for (const [, content] of custom) assert.equal(defaultPrompt.includes(content), false)
})

test('默认加载 .eli 与 .agents 技能，项目同名技能优先且用户级兜底，不扫描其他资源目录', async (t) => {
  const f = await fixture(t)
  const requests = await modelServer(t, f.data)
  const projectData = join(f.cwd, '.eli')
  const sharedSkills = join(f.root, 'home', '.agents', 'skills')
  const projectAgentSkills = join(f.cwd, '.agents', 'skills')
  for (const directory of [
    join(f.data, 'skills/global'),
    join(f.data, 'skills/project'),
    join(f.data, 'skills/project-agents'),
    join(projectData, 'skills/project'),
    join(sharedSkills, 'shared'),
    join(sharedSkills, 'project'),
    join(sharedSkills, 'project-agents'),
    join(projectData, 'extensions'),
    join(projectData, 'prompts'),
    join(f.cwd, '.pi/extensions'),
    join(f.cwd, '.agents/extensions'),
    join(projectAgentSkills, 'project-agents'),
    join(projectAgentSkills, 'project')
  ])
    await mkdir(directory, { recursive: true })
  await writeFile(
    join(f.data, 'skills/global/SKILL.md'),
    '---\nname: global\ndescription: Global fixture\n---\nGlobal skill'
  )
  await writeFile(
    join(f.data, 'skills/project/SKILL.md'),
    '---\nname: project\ndescription: User eli project duplicate fixture\n---\nUser eli project skill'
  )
  await writeFile(
    join(f.data, 'skills/project-agents/SKILL.md'),
    '---\nname: project-agents\ndescription: User eli duplicate fixture\n---\nUser eli skill'
  )
  await writeFile(
    join(projectData, 'skills/project/SKILL.md'),
    '---\nname: project\ndescription: Project fixture\n---\nProject skill'
  )
  await writeFile(
    join(sharedSkills, 'shared/SKILL.md'),
    '---\nname: shared\ndescription: Shared fixture\n---\nSHARED_SKILL_BODY'
  )
  await writeFile(
    join(sharedSkills, 'project/SKILL.md'),
    '---\nname: project\ndescription: Shared duplicate fixture\n---\nShared duplicate skill'
  )
  await writeFile(
    join(sharedSkills, 'project-agents/SKILL.md'),
    '---\nname: project-agents\ndescription: User agents duplicate fixture\n---\nUser agents skill'
  )
  await writeFile(
    join(projectAgentSkills, 'project-agents/SKILL.md'),
    '---\nname: project-agents\ndescription: Project agents fixture\n---\nPROJECT_AGENTS_SKILL_BODY'
  )
  await writeFile(
    join(projectAgentSkills, 'project/SKILL.md'),
    '---\nname: project\ndescription: Project agents duplicate fixture\n---\nProject agents duplicate skill'
  )
  await writeFile(
    join(f.cwd, '.pi/extensions/broken.ts'),
    'throw new Error("pi extension must not load")'
  )
  await writeFile(
    join(f.cwd, '.agents/extensions/broken.ts'),
    'throw new Error("agents extension must not load")'
  )
  const config = JSON.parse(await readFile(join(f.data, 'config.json'), 'utf8'))
  config.agent.hideThinkingBlock = true
  await writeFile(join(f.data, 'config.json'), JSON.stringify(config))
  // 项目里的旧设置既不加载，也不改写。
  await writeFile(join(projectData, 'settings.json'), '{ old project settings')
  await writeFile(
    join(projectData, 'prompts/greet.md'),
    '---\ndescription: Greet fixture\n---\nHello $1'
  )
  await writeFile(
    join(projectData, 'extensions/local.ts'),
    `
    import { writeFileSync } from 'node:fs'
    import { join } from 'node:path'
    export default function(pi) {
      pi.on('session_start', () => writeFileSync(join(process.cwd(), 'extension-loaded.txt'), 'loaded'))
      pi.on('session_shutdown', (event) => writeFileSync(join(process.cwd(), 'extension-closed.txt'), event.reason))
      pi.registerCommand('local-command', { description: 'Fixture', handler: async (_args, ctx) => ctx.ui.notify('extension command completed') })
    }
  `
  )
  const r = runtime(t)
  const state = await initialize(r.connection, f)
  assert.equal(state.snapshot.hideThinkingBlock, true)
  assert.equal(await readFile(join(projectData, 'settings.json'), 'utf8'), '{ old project settings')
  assert.equal(await readFile(join(f.cwd, 'extension-loaded.txt'), 'utf8'), 'loaded')
  const skills = await r.connection.call('getSkills')
  assert.deepEqual(skills.map(({ name }) => name).sort(), [
    'skill:global',
    'skill:project',
    'skill:project-agents',
    'skill:shared'
  ])
  assert.equal(skills.find(({ name }) => name === 'skill:project').description, 'Project fixture')
  assert.equal(
    skills.find(({ name }) => name === 'skill:project-agents').description,
    'Project agents fixture'
  )
  await r.connection.call('prompt', '/local-command')
  const handled = await until(() =>
    r.states.findLast(
      (state) => !state.snapshot.running && state.snapshot.error === 'extension command completed'
    )
  )
  assert.equal(
    handled.snapshot.messages.filter((message) => message.role === 'assistant').length,
    0
  )
  r.states.length = 0
  await r.connection.call('prompt', '/greet world')
  const done = await until(() =>
    r.states.findLast(
      (state) =>
        !state.snapshot.running &&
        state.snapshot.messages.some((message) => message.role === 'assistant')
    )
  )
  assert.ok(JSON.stringify(done.snapshot.messages).includes('Hello world'))
  const systemPrompt = requests[0].messages.find((message) => message.role === 'system').content
  assert.match(systemPrompt, /<name>shared<\/name>/)
  assert.match(systemPrompt, /<description>Shared fixture<\/description>/)
  assert.ok(systemPrompt.includes(join(sharedSkills, 'shared/SKILL.md')))
  assert.doesNotMatch(systemPrompt, /SHARED_SKILL_BODY/)
  assert.match(systemPrompt, /<name>project-agents<\/name>/)
  assert.match(systemPrompt, /<description>Project agents fixture<\/description>/)
  assert.ok(systemPrompt.includes(join(projectAgentSkills, 'project-agents/SKILL.md')))
  assert.doesNotMatch(systemPrompt, /PROJECT_AGENTS_SKILL_BODY/)
  assert.doesNotMatch(systemPrompt, /User eli duplicate fixture|User agents duplicate fixture/)
  await r.connection.stop()
  assert.equal(await readFile(join(f.cwd, 'extension-closed.txt'), 'utf8'), 'quit')
  await rm(join(projectAgentSkills, 'project-agents/SKILL.md'))
  const fallback = runtime(t)
  await initialize(fallback.connection, f, 'fallback-skills')
  const fallbackSkills = await fallback.connection.call('getSkills')
  assert.equal(
    fallbackSkills.find(({ name }) => name === 'skill:project-agents').description,
    'User eli duplicate fixture'
  )
  assert.equal(
    fallbackSkills.find(({ name }) => name === 'skill:shared').description,
    'Shared fixture'
  )
})

test('Skill 开关经控制协议保存并过滤模型和命令，保留项目同名 Skill 且可重新开启', async (t) => {
  const f = await fixture(t)
  const requests = await modelServer(t, f.data)
  const userDirectory = join(f.data, 'skills')
  const sharedDirectory = join(f.root, 'home/.agents/skills')
  const projectDirectory = join(f.cwd, '.agents/skills')
  for (const [directory, name, description] of [
    [userDirectory, 'user-only', 'Hidden user fixture'],
    [sharedDirectory, 'user-only', 'Fallback user fixture'],
    [sharedDirectory, 'shared-only', 'Hidden shared fixture'],
    [userDirectory, 'same-name', 'Hidden same-name user fixture'],
    [projectDirectory, 'same-name', 'Visible same-name project fixture'],
    [projectDirectory, 'project-only', 'Visible project fixture']
  ]) {
    await mkdir(join(directory, name), { recursive: true })
    await writeFile(
      join(directory, name, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${description}\n---\n${description} BODY`
    )
  }
  const control = runtime(t)
  await control.connection.call('initialize', {
    kind: 'control',
    root: f.data,
    cwd: f.cwd,
    firstLaunch: false
  })
  const catalog = await control.connection.call('getUserSkills')
  assert.deepEqual(
    catalog.map(({ name }) => name),
    ['same-name', 'shared-only', 'user-only']
  )
  assert.ok(catalog.every(({ enabled }) => enabled))
  const original = JSON.parse(await readFile(join(f.data, 'config.json'), 'utf8'))
  for (const skill of catalog)
    await control.connection.call('setSkillEnabled', skill.filePath, false)
  const disabled = await control.connection.call('getUserSkills')
  assert.equal(disabled.length, catalog.length)
  assert.ok(disabled.every(({ enabled }) => !enabled))
  const saved = JSON.parse(await readFile(join(f.data, 'config.json'), 'utf8'))
  assert.deepEqual(
    { agent: saved.agent, credentials: saved.credentials, providers: saved.providers },
    original
  )
  assert.deepEqual(new Set(saved.disabledSkills), new Set(catalog.map(({ filePath }) => filePath)))
  await assert.rejects(
    control.connection.call(
      'setSkillEnabled',
      join(projectDirectory, 'project-only/SKILL.md'),
      false
    ),
    /用户级 Skill 不存在/
  )
  const first = runtime(t)
  await initialize(first.connection, f)
  assert.deepEqual((await first.connection.call('getSkills')).map(({ name }) => name).sort(), [
    'skill:project-only',
    'skill:same-name'
  ])
  await first.connection.call('prompt', '/skill:user-only')
  await until(() =>
    first.states.findLast(
      (state) =>
        !state.snapshot.running && state.snapshot.messages.some(({ role }) => role === 'assistant')
    )
  )
  const prompt = requests[0].messages.find(({ role }) => role === 'system').content
  assert.match(prompt, /Visible same-name project fixture/)
  assert.match(prompt, /Visible project fixture/)
  assert.doesNotMatch(prompt, /Hidden|Fallback user fixture|user-only|shared-only/)
  assert.doesNotMatch(JSON.stringify(requests), /Hidden user fixture BODY/)
  await first.connection.stop()
  for (const skill of catalog)
    await control.connection.call('setSkillEnabled', skill.filePath, true)
  const restored = runtime(t)
  await initialize(restored.connection, f, 'restored-skills')
  assert.deepEqual((await restored.connection.call('getSkills')).map(({ name }) => name).sort(), [
    'skill:project-only',
    'skill:same-name',
    'skill:shared-only',
    'skill:user-only'
  ])
  await restored.connection.call('prompt', '/skill:user-only')
  await until(() =>
    restored.states.findLast(
      (state) =>
        !state.snapshot.running && state.snapshot.messages.some(({ role }) => role === 'assistant')
    )
  )
  assert.match(
    requests.at(-1).messages.find(({ role }) => role === 'system').content,
    /Hidden user fixture/
  )
  assert.match(JSON.stringify(requests.at(-1)), /Hidden user fixture BODY/)
})

test('等待审批时关闭 Runtime 会取消等待；其他会话继续工作', async (t) => {
  const f = await fixture(t)
  await modelServer(t, f.data)
  const first = runtime(t)
  const second = runtime(t)
  await Promise.all([
    initialize(first.connection, f),
    initialize(second.connection, f, '44444444-4444-4444-8444-444444444444')
  ])
  await first.connection.call('prompt', 'WRITE_TOOL')
  const pending = await until(() =>
    first.states.findLast((state) => state.snapshot.toolApprovals.length)
  )
  await assert.rejects(
    second.connection.call('approve', pending.snapshot.toolApprovals[0].id, true),
    /失效/
  )
  await first.connection.stop()
  await assert.rejects(readFile(join(f.cwd, 'approved.txt')), { code: 'ENOENT' })
  await second.connection.call('prompt', '仍可运行')
  const done = await until(() =>
    second.states.findLast(
      (state) =>
        !state.snapshot.running &&
        state.snapshot.messages.some((message) => message.role === 'assistant')
    )
  )
  assert.equal(
    done.snapshot.messages.findLast((message) => message.role === 'assistant').stopReason,
    'stop'
  )
})

test('手动压缩可中止；空历史压缩保持就绪', async (t) => {
  const f = await fixture(t)
  await modelServer(t, f.data)
  const saved = JSON.parse(await readFile(join(f.data, 'config.json'), 'utf8'))
  saved.agent.compaction = { enabled: false, keepRecentTokens: 1, reserveTokens: 128 }
  await writeFile(join(f.data, 'config.json'), JSON.stringify(saved))
  const r = runtime(t)
  await initialize(r.connection, f)
  await r.connection.call('compact')
  const empty = await until(() => r.states.findLast((state) => !state.snapshot.running))
  assert.equal(empty.snapshot.connection, 'ready')
  assert.equal(empty.snapshot.error, null)
  for (let i = 0; i < 3; i++) {
    r.states.length = 0
    await r.connection.call('prompt', `message ${i}: ${'context '.repeat(100)}`)
    await until(() =>
      r.states.findLast(
        (state) =>
          !state.snapshot.running &&
          state.snapshot.messages.filter((message) => message.role === 'assistant').length === i + 1
      )
    )
  }
  r.states.length = 0
  const accepted = await r.connection.call('compact', 'WAIT_FOREVER')
  assert.equal(accepted.snapshot.running, true)
  await r.connection.call('abort')
  const stopped = await until(() => r.states.findLast((state) => !state.snapshot.running))
  assert.equal(stopped.snapshot.activity, '已停止')
  r.states.length = 0
  await r.connection.call('compact', 'Summarize the completed work')
  const compacted = await until(() => r.states.findLast((state) => !state.snapshot.running))
  assert.equal(compacted.snapshot.activity, '上下文压缩完成')
  assert.equal(compacted.snapshot.error, null)
  assert.ok((await readFile(compacted.persistedFile, 'utf8')).includes('"type":"compaction"'))
})
