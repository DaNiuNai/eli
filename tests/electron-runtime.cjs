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
        // 三个审核全部到达才返回，串行审核会卡住此屏障。
        await new Promise((resolve) => {
          reviewReplies.push(resolve)
          if (reviewReplies.length === 3) for (const finish of reviewReplies.toReversed()) finish()
        })
        send({ content: JSON.stringify({ decision: 'allow', reason: '用户要求创建测试文件' }) })
        send({}, 'stop')
      } else if (body.messages.at(-1).role !== 'tool') {
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
      terminal: { kind: 'powershell', path: 'powershell.exe' }
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
    await request('prompt', '请在工作目录创建 approved-0.txt、approved-1.txt、approved-2.txt')
    while (
      !states.some((state) => !state.snapshot.running && state.snapshot.messages.length >= 6)
    ) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.equal(reviewReplies.length, 3)
    for (let index = 0; index < 3; index++)
      assert.equal(readFileSync(join(cwd, `approved-${index}.txt`), 'utf8'), 'electron-approved')
    assert.ok(requests.some((body) => body.model === 'reviewer' && !body.tools?.length))
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
    await request('shutdown')
    await exited
    assert.deepEqual(JSON.parse(readFileSync(join(data, 'config.json'), 'utf8')), savedConfig)
    for (const name of ['settings.json', 'models.json', 'providers.json', 'auth.json'])
      assert.equal(existsSync(join(data, name)), false, `${name} must not be created`)
    assert.ok(directory.startsWith(`${temporary}\\`) || directory.startsWith(`${temporary}/`))
    console.log(
      `Electron utilityProcess + SDK + MCP / skill management + project extension + auto approval: PASS (${entry})`
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
