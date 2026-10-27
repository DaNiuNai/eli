const { app, utilityProcess } = require('electron')
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } = require('node:fs')
const { join, resolve } = require('node:path')
const assert = require('node:assert/strict')
const { createServer } = require('node:http')

const workspace = resolve(__dirname, '..')
const temporary = join(workspace, '.tmp')
mkdirSync(temporary, { recursive: true })
const directory = process.argv[3] || mkdtempSync(join(temporary, 'electron-runtime-'))
const data = join(directory, '.eli')
const cwd = join(directory, 'workspace')
mkdirSync(data, { recursive: true })
const customInstructionPath = join(directory, 'custom rules.md')
const customInstruction = 'ELI_ELECTRON_CUSTOM_INSTRUCTION'
writeFileSync(customInstructionPath, customInstruction)
writeFileSync(join(data, 'AGENTS.md'), 'ELI_ELECTRON_GLOBAL_INSTRUCTION')
mkdirSync(join(data, 'skills', 'project-agents'), { recursive: true })
writeFileSync(
  join(data, 'skills', 'project-agents', 'SKILL.md'),
  '---\nname: project-agents\ndescription: User duplicate Electron fixture\n---\nUser duplicate skill body'
)
mkdirSync(join(data, 'skills', 'user-disabled'), { recursive: true })
const disabledSkillPath = join(data, 'skills', 'user-disabled', 'SKILL.md')
const disabledSkillContent =
  '---\nname: user-disabled\ndescription: Disabled Electron fixture\n---\nDisabled Electron skill body'
writeFileSync(disabledSkillPath, disabledSkillContent)
mkdirSync(join(directory, '.agents', 'skills', 'shared'), { recursive: true })
writeFileSync(
  join(directory, '.agents', 'skills', 'shared', 'SKILL.md'),
  '---\nname: shared\ndescription: Shared Electron fixture\n---\nShared skill body'
)
mkdirSync(join(cwd, '.agents', 'skills', 'project-agents'), { recursive: true })
writeFileSync(
  join(cwd, '.agents', 'skills', 'project-agents', 'SKILL.md'),
  '---\nname: project-agents\ndescription: Project agents Electron fixture\n---\nProject agents skill body'
)
mkdirSync(join(cwd, '.eli', 'extensions'), { recursive: true })
writeFileSync(
  join(cwd, '.eli', 'extensions', 'probe.ts'),
  `
  export default function(pi) {
    pi.registerCommand('probe', { description: 'Package smoke test', handler: async (_args, ctx) => ctx.ui.notify('packaged extension ready') })
  }
`
)
writeFileSync(join(data, 'config.json'), JSON.stringify({ agent: { cacheWarming: 'off' } }))
app.setPath('userData', join(directory, 'electron'))
app.disableHardwareAcceleration()
const entry = resolve(process.argv[2] || join(workspace, 'out', 'main', 'runtime.mjs'))
let child
let server
const authServerCleanups = []
const mcpAuthStates = []
let nextId = 0
const pending = new Map()
const states = []
const requests = []
const reviewReplies = []

function request(method, ...args) {
  const id = String(++nextId)
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    child.postMessage({ version: 1, kind: 'request', id, agentId: 'main', method, args })
  })
}

async function startRuntime() {
  child = utilityProcess.fork(entry, [], { serviceName: 'eli Runtime smoke test', stdio: 'pipe' })
  child.stdout.resume()
  child.stderr.on('data', (chunk) => process.stderr.write(chunk))
  const exited = new Promise((resolve) => child.once('exit', resolve))
  await new Promise((resolve, reject) => {
    child.once('exit', (code) => reject(new Error(`Runtime exited: ${code}`)))
    child.on('message', (message) => {
      if (message.kind === 'session') states.push(message.state)
      if (message.kind === 'mcp_auth') mcpAuthStates.push(message.snapshot)
      if (message.kind === 'ready') resolve()
      if (message.kind === 'fatal') reject(new Error(message.error))
      if (message.kind === 'response') {
        const current = pending.get(message.id)
        pending.delete(message.id)
        if (message.ok) current?.resolve(message.result)
        else current?.reject(new Error(message.error))
      }
    })
  })
  return { exited }
}

const timeout = setTimeout(() => {
  console.error('Electron Runtime smoke test timed out')
  child?.kill()
  app.exit(1)
}, 45000)
app.whenReady().then(async () => {
  try {
    server = createServer(async (req, res) => {
      let text = ''
      for await (const chunk of req) text += chunk
      const body = JSON.parse(text)
      requests.push(body)
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const send = (delta, finish_reason = null) =>
        res.write(
          `data: ${JSON.stringify({ id: 'electron-test', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`
        )
      send({ role: 'assistant', content: '' })
      if (body.model === 'reviewer') {
        const firstAttempt = !body.messages.some(({ role }) => role === 'assistant')
        if (firstAttempt) {
          // 三个首次审核全部到达才返回，串行审核会卡住此屏障。
          await new Promise((resolve) => {
            reviewReplies.push(resolve)
            if (reviewReplies.length === 3)
              for (const finish of reviewReplies.toReversed()) finish()
          })
        }
        const context = JSON.parse(body.messages.find(({ role }) => role === 'user').content)
        if (firstAttempt && context.pendingTool.input.path === 'approved-0.txt') {
          send({ content: '允许创建测试文件' })
          send({}, 'stop')
        } else {
          send({
            tool_calls: [
              {
                index: 0,
                id: 'structured-review',
                type: 'function',
                function: {
                  name: 'structured_output',
                  arguments: JSON.stringify({ decision: 'allow', reason: '用户要求创建测试文件' })
                }
              }
            ]
          })
          send({}, 'tool_calls')
        }
      } else if (
        JSON.stringify(body.messages.findLast(({ role }) => role === 'user')?.content).includes(
          'Message Type: FINAL_ANSWER'
        )
      ) {
        send({ content: '子任务汇总完成' })
        send({}, 'stop')
      } else if (body.messages.at(-1).role !== 'tool') {
        if (
          JSON.stringify(body.messages.findLast(({ role }) => role === 'user')?.content).includes(
            'SUBAGENT_TEST'
          )
        ) {
          send({
            tool_calls: [
              {
                index: 0,
                id: 'electron-subagent',
                type: 'function',
                function: {
                  name: 'spawn_agent',
                  arguments: JSON.stringify({
                    task_name: 'worker',
                    message: '创建三个测试文件',
                    fork_turns: 'none'
                  })
                }
              }
            ]
          })
          send({}, 'tool_calls')
          res.end('data: [DONE]\n\n')
          return
        }
        if (
          JSON.stringify(body.messages.findLast(({ role }) => role === 'user')?.content).includes(
            'BACKGROUND_TEST'
          )
        ) {
          send({
            tool_calls: [
              {
                index: 0,
                id: 'electron-background',
                type: 'function',
                function: {
                  name: 'powershell',
                  arguments: JSON.stringify({
                    command: "Write-Output 'electron-background-ready'; Start-Sleep -Seconds 60",
                    background: true
                  })
                }
              }
            ]
          })
          send({}, 'tool_calls')
          res.end('data: [DONE]\n\n')
          return
        }
        send({
          tool_calls: Array.from({ length: 3 }, (_, index) => ({
            index,
            id: `electron-write-${index}`,
            type: 'function',
            function: {
              name: 'write',
              arguments: JSON.stringify({
                path: `approved-${index}.txt`,
                content: 'electron-approved'
              })
            }
          }))
        })
        send({}, 'tool_calls')
      } else {
        send({ content: '完成' })
        send({}, 'stop')
      }
      res.end('data: [DONE]\n\n')
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const config = {
      app: { autoApprovalModel: { provider: 'electron-test', id: 'reviewer' } },
      agent: {
        cacheWarming: 'off',
        defaultProvider: 'electron-test',
        defaultModel: 'local',
        enabledModels: ['electron-test/*'],
        retry: { enabled: false }
      },
      credentials: { 'api_key:electron-test': { type: 'api_key', key: 'electron-test-only' } },
      providers: {
        'electron-test': {
          custom: true,
          api: 'openai-completions',
          baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
          models: ['local', 'reviewer'].map((id) => ({
            id,
            name: id,
            reasoning: false,
            vision: false,
            contextWindow: 32768,
            maxTokens: 4096
          }))
        }
      }
    }
    writeFileSync(join(data, 'config.json'), JSON.stringify(config))
    const control = await startRuntime()
    await request('initialize', {
      kind: 'control',
      root: data,
      cwd,
      firstLaunch: false
    })
    const models = await request('changeProvider', {
      action: 'saveModel',
      id: 'electron-test',
      model: {
        ...config.providers['electron-test'].models[0],
        reasoning: true,
        supportsXhigh: true,
        supportsMax: true
      }
    })
    const localModel = models.providers
      .find(({ id }) => id === 'electron-test')
      .models.find(({ id }) => id === 'local')
    assert.equal(localModel.supportsXhigh, true)
    assert.equal(localModel.supportsMax, true)
    await request('saveSettings', [{ key: 'defaultThinkingLevel', value: 'max' }])
    const instructions = await request('saveSettings', [
      { key: 'agentsFiles', value: [customInstructionPath, customInstructionPath] }
    ])
    assert.deepEqual(instructions.values.agentsFiles, [
      customInstructionPath,
      customInstructionPath
    ])
    const catalog = await request('getUserSkills')
    assert.deepEqual(
      catalog.map(({ name }) => name),
      ['project-agents', 'shared', 'user-disabled']
    )
    await request('setSkillEnabled', disabledSkillPath, false)
    await request('setSkillEnabled', join(data, 'skills/project-agents/SKILL.md'), false)
    const managed = await request('getUserSkills')
    assert.equal(managed.find(({ name }) => name === 'user-disabled').enabled, false)
    assert.equal(managed.find(({ name }) => name === 'shared').enabled, true)
    assert.deepEqual(await request('getMcpServers'), [])
    const mcpConfig = {
      type: 'stdio',
      command: 'node',
      args: [join(workspace, 'tests/fixtures/mcp-stdio.mjs'), join(directory, 'mcp.log')],
      exposure: 'direct'
    }
    await request('changeMcpServer', { action: 'create', name: 'electron-mcp', config: mcpConfig })
    const mcpTest = await request('testMcpServer', 'electron-mcp')
    assert.equal(mcpTest.status, 'connected')
    assert.deepEqual(
      mcpTest.tools.map(({ name }) => name),
      ['echo']
    )
    await request('changeMcpServer', { action: 'setEnabled', name: 'electron-mcp', enabled: false })
    const { mcpOAuthServer } = await import('./fixtures/mcp-oauth.mjs')
    const oauthServer = await mcpOAuthServer({
      after: (cleanup) => authServerCleanups.push(cleanup)
    })
    await request('changeMcpServer', {
      action: 'create',
      name: 'electron-oauth',
      config: { url: oauthServer.url, enabled: false }
    })
    const authProbe = await request('testMcpServer', 'electron-oauth')
    assert.equal(authProbe.authentication.method, 'oauth')
    await request('startMcpAuth', 'electron-oauth')
    while (!mcpAuthStates.some((snapshot) => snapshot.authorizationUrl))
      await new Promise((resolve) => setTimeout(resolve, 10))
    const authPending = mcpAuthStates.find((snapshot) => snapshot.authorizationUrl)
    assert.equal(await request('validateMcpAuthLink', authPending.id), authPending.authorizationUrl)
    await fetch(authPending.authorizationUrl)
    while (!mcpAuthStates.some((snapshot) => snapshot.status === 'success'))
      await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal((await request('getMcpAuth')).result.status, 'connected')
    assert.equal(oauthServer.exchanges(), 1)
    assert.equal(JSON.stringify(mcpAuthStates).includes('eli-mcp-test-access-token'), false)
    assert.equal(
      (await request('getMcpServers')).find(({ name }) => name === 'electron-oauth').authentication
        .state,
      'authenticated'
    )
    await request('startMcpAuth', 'electron-oauth', true)
    while (
      !mcpAuthStates.some((snapshot) => snapshot.authorizationUrl && snapshot.id !== authPending.id)
    )
      await new Promise((resolve) => setTimeout(resolve, 10))
    const again = mcpAuthStates.find(
      (snapshot) => snapshot.authorizationUrl && snapshot.id !== authPending.id
    )
    await fetch(again.authorizationUrl)
    while (
      !mcpAuthStates.some((snapshot) => snapshot.id === again.id && snapshot.status === 'success')
    )
      await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(oauthServer.exchanges(), 2)
    const signedOut = await request('signOutMcpAuth', 'electron-oauth')
    assert.equal(
      signedOut.find(({ name }) => name === 'electron-oauth').authentication.state,
      'unauthenticated'
    )
    assert.equal((await request('getMcpAuth')).status, 'signed-out')
    await request('shutdown')
    await control.exited
    const savedConfig = JSON.parse(readFileSync(join(data, 'config.json'), 'utf8'))
    assert.deepEqual(savedConfig.agent.agentsFiles, [customInstructionPath, customInstructionPath])
    assert.deepEqual(
      new Set(savedConfig.disabledSkills),
      new Set([disabledSkillPath, join(data, 'skills/project-agents/SKILL.md')])
    )
    assert.equal(savedConfig.mcpServers['electron-mcp'].enabled, false)
    const { exited } = await startRuntime()
    const state = await request('initialize', {
      kind: 'session',
      root: data,
      cwd,
      sessionKey: '55555555-5555-4555-8555-555555555555',
      approvalMode: 'auto',
      terminal: {
        kind: 'powershell',
        path: (await import('@earendil-works/pi-coding-agent')).getPowerShellConfig().shell
      }
    })
    assert.equal(state.snapshot.connection, 'ready')
    assert.ok(state.snapshot.thinkingLevels.includes('xhigh'))
    assert.ok(state.snapshot.thinkingLevels.includes('max'))
    assert.equal(state.snapshot.session.thinkingLevel, 'max')
    assert.equal(state.persistedFile, undefined)
    assert.deepEqual(await request('getSkills'), [
      { name: 'skill:project-agents', description: 'Project agents Electron fixture' },
      { name: 'skill:shared', description: 'Shared Electron fixture' }
    ])
    const instruction =
      '请在工作目录创建 approved-0.txt、approved-1.txt、approved-2.txt\n' +
      '上下文预算测试。'.repeat(1500)
    await request('prompt', instruction)
    while (
      !states.some((state) => !state.snapshot.running && state.snapshot.messages.length >= 6)
    ) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.equal(reviewReplies.length, 3)
    for (let index = 0; index < 3; index++)
      assert.equal(readFileSync(join(cwd, `approved-${index}.txt`), 'utf8'), 'electron-approved')
    const reviews = requests.filter((body) => body.model === 'reviewer')
    assert.equal(reviews.length, 4)
    for (const body of reviews) {
      assert.equal(body.tools.length, 1)
      assert.equal(body.tools[0].function.name, 'structured_output')
      assert.deepEqual(body.tools[0].function.parameters.required, ['decision', 'reason'])
      assert.equal(body.tool_choice, 'required')
      const context = JSON.parse(body.messages.find(({ role }) => role === 'user').content)
      assert.ok(
        context.history.some(({ role, content }) => role === 'user' && content === instruction)
      )
    }
    const retried = reviews.find((body) => body.messages.some(({ role }) => role === 'assistant'))
    assert.ok(retried)
    assert.equal(retried.messages.at(-2).content, '允许创建测试文件')
    assert.match(retried.messages.at(-1).content, /未通过格式校验/)
    assert.ok(requests.some((body) => body.model === 'local' && body.reasoning_effort === 'max'))
    assert.ok(states.every((state) => !state.snapshot.toolApprovals.length))
    const systemPrompt = requests
      .find((body) => body.model === 'local')
      .messages.find(({ role }) => role === 'system' || role === 'developer').content
    assert.doesNotMatch(systemPrompt, /user-disabled|Disabled Electron fixture/)
    assert.match(systemPrompt, /Project agents Electron fixture/)
    assert.equal(systemPrompt.split(customInstruction).length - 1, 1)
    assert.ok(
      systemPrompt.indexOf('ELI_ELECTRON_GLOBAL_INSTRUCTION') <
        systemPrompt.indexOf(customInstruction)
    )
    assert.equal(readFileSync(disabledSkillPath, 'utf8'), disabledSkillContent)
    await request('configure', 'all')
    await request('prompt', 'BACKGROUND_TEST')
    while (
      !states
        .at(-1)
        ?.snapshot.backgroundTasks.some((task) =>
          task.output.includes('electron-background-ready')
        ) ||
      states.at(-1)?.snapshot.running
    ) {
      const failed = states
        .at(-1)
        ?.snapshot.backgroundTasks.find((task) => task.status === 'failed')
      if (failed) throw new Error(failed.error ?? failed.output)
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    const background = states.at(-1).snapshot.backgroundTasks[0]
    assert.equal(background.status, 'running')
    await request('abort')
    assert.equal(states.at(-1).snapshot.backgroundTasks[0].status, 'running')
    await request('stopBackgroundTask', background.id)
    while (states.at(-1)?.snapshot.backgroundTasks[0]?.status !== 'cancelled')
      await new Promise((resolve) => setTimeout(resolve, 20))
    assert.match(readFileSync(background.logPath, 'utf8'), /electron-background-ready/)
    await request('configure', 'request')
    await request('prompt', 'SUBAGENT_TEST')
    const approvedSubagentCalls = new Set()
    while (
      states.at(-1)?.snapshot.subagents[0]?.status !== 'completed' ||
      states.at(-1)?.snapshot.running
    ) {
      for (const approval of states.at(-1)?.snapshot.toolApprovals ?? []) {
        assert.equal(approval.agentId, '/root/worker')
        if (!approvedSubagentCalls.has(approval.id)) {
          approvedSubagentCalls.add(approval.id)
          await request('approve', approval.id, true)
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.equal(approvedSubagentCalls.size, 3)
    assert.equal(states.at(-1).snapshot.subagents[0].id, '/root/worker')
    assert.equal(states.at(-1).snapshot.subagents[0].snapshot.model.id, 'local')
    assert.ok(
      states
        .at(-1)
        .snapshot.messages.some(
          (message) => message.role === 'custom' && message.content.includes('FINAL_ANSWER')
        )
    )
    await request('controlSubagent', {
      type: 'message',
      target: '/root/worker',
      message: '仅保存协作消息'
    })
    assert.equal(states.at(-1).snapshot.subagents[0].status, 'completed')
    await request('shutdown')
    await exited
    assert.deepEqual(JSON.parse(readFileSync(join(data, 'config.json'), 'utf8')), savedConfig)
    for (const name of ['settings.json', 'models.json', 'providers.json', 'auth.json'])
      assert.equal(existsSync(join(data, name)), false, `${name} must not be created`)
    assert.ok(directory.startsWith(`${temporary}\\`) || directory.startsWith(`${temporary}/`))
    console.log(
      `Electron utilityProcess + SDK + MCP / skill management + project extension + auto approval + subagents: PASS (${entry})`
    )
    server.closeAllConnections()
    server.close()
    for (const cleanup of authServerCleanups) cleanup()
    clearTimeout(timeout)
    app.exit(0)
  } catch (error) {
    server?.closeAllConnections()
    server?.close()
    for (const cleanup of authServerCleanups) cleanup()
    console.error(error)
    child?.kill()
    clearTimeout(timeout)
    app.exit(1)
  }
})
