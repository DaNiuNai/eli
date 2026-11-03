const { app, utilityProcess, nativeImage } = require('electron')
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
  export const inject = ['commands']
  export function apply(ctx) {
    ctx.effect(() => ctx.commands.register({ name: 'probe', description: 'Package smoke test', handler: async () => ({ kind: 'success', text: 'packaged extension ready' }) }))
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
let rejectImageRequests = false

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
      if (rejectImageRequests && JSON.stringify(body).includes('data:image/')) {
        res.writeHead(413, { 'content-type': 'text/plain' })
        res.end('Failed to buffer the request body: length limit exceeded')
        return
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const send = (delta, finish_reason = null) =>
        res.write(
          `data: ${JSON.stringify({ id: 'electron-test', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`
        )
      send({ role: 'assistant', content: '' })
      if (
        body.messages.some(
          ({ role, content }) =>
            role === 'user' && JSON.stringify(content).includes('ELI_PROGRAM_TEST')
        )
      ) {
        if (body.messages.at(-1).role === 'tool') {
          send({ content: '程序工具执行完成' })
          send({}, 'stop')
        } else {
          assert.deepEqual(
            body.tools.map(({ function: tool }) => tool.name),
            ['run_code']
          )
          send({
            tool_calls: [
              {
                index: 0,
                id: 'program-probe',
                type: 'function',
                function: {
                  name: 'run_code',
                  arguments: JSON.stringify({
                    code: 'return (await tools.read({path:"program-fixture.txt"})).content[0].text',
                    description: 'read the program fixture'
                  })
                }
              }
            ]
          })
          send({}, 'tool_calls')
        }
      } else if (body.model === 'reviewer') {
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
        body.messages.some((message) =>
          JSON.stringify(message.content).includes('acting as a compaction engine')
        )
      ) {
        send({ content: '摘要已生成，保留图片与文档的文字分析。' })
        send({}, 'stop')
      } else if (
        body.messages.some(
          ({ role, content }) =>
            role === 'user' && JSON.stringify(content).includes('ELI_IMAGE_TEST')
        )
      ) {
        // dsh 只提交比原文更短的摘要，提供足够的历史分析来覆盖该路径。
        send({
          content:
            '图片分析记录：已核对输入图片的尺寸、比例和内容，保留后续任务需要的文字证据。'.repeat(
              40
            )
        })
        send({}, 'stop')
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
        path: (await import('./fixtures/terminal.mjs')).getPowerShellConfig().shell
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
    const trajectory = await request('readTrajectory', {})
    const writes = trajectory.rows.filter((row) => row.kind === 'tool' && row.label === 'write')
    assert.equal(writes.length, 3)
    const inspection = await request('readTrajectory', { selected: writes[0].seq })
    assert.deepEqual(
      inspection.detail.map((event) => event.type),
      ['tool/call', 'tool/result']
    )
    assert.match(inspection.detail[0].value.arguments.path, /approved-\d\.txt$/)
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
    assert.match(systemPrompt, /大量图片.*小于 1 MB 的 JPG/)
    assert.ok(systemPrompt.indexOf('大量图片') > systemPrompt.indexOf('eli 协作团队'))
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
    const usageControl = await startRuntime()
    await request('initialize', { kind: 'control', root: data, cwd, firstLaunch: false })
    const usageLibrary = await request('getLibrary')
    assert.equal(
      usageLibrary.requests.length,
      states.at(-1).snapshot.messages.filter((message) => message.role === 'assistant').length
    )
    assert.equal(
      usageLibrary.usage.reduce((sum, record) => sum + record.requests, 0),
      usageLibrary.requests.length
    )
    assert.ok(
      usageLibrary.requests.every(
        (record) =>
          record.model === 'local' &&
          Number.isFinite(record.timestamp) &&
          Number.isFinite(record.cacheRead) &&
          Number.isFinite(record.cacheWrite)
      )
    )
    assert.ok(usageLibrary.requests.some((record) => record.stopReason === 'stop'))
    assert.ok(usageLibrary.requests.some((record) => record.stopReason === 'toolUse'))
    await request('shutdown')
    await usageControl.exited
    assert.deepEqual(JSON.parse(readFileSync(join(data, 'config.json'), 'utf8')), savedConfig)
    for (const name of ['settings.json', 'models.json', 'providers.json', 'auth.json'])
      assert.equal(existsSync(join(data, name)), false, `${name} must not be created`)
    const { createPng, requestImages } = await import('./fixtures/images.mjs')
    const sourceImage = createPng()
    const imagePath = join(cwd, 'electron-large.png')
    writeFileSync(imagePath, sourceImage)
    writeFileSync(
      join(cwd, '.eli/extensions/image-input.mjs'),
      `import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
${(await import('./fixtures/plugin-source.mjs')).imageInputPlugin('ELI_IMAGE_TEST', `await readFile(join(ctx.eli.cwd, 'electron-large.png'))`)}
`
    )
    const imageConfig = structuredClone(savedConfig)
    imageConfig.agent.compaction = { enabled: false, keepRecentTokens: 1, reserveTokens: 128 }
    imageConfig.providers['electron-test'].models.find(({ id }) => id === 'local').vision = true
    writeFileSync(join(data, 'config.json'), JSON.stringify(imageConfig))
    const imageSession = await startRuntime()
    states.length = 0
    await request('initialize', {
      kind: 'session',
      root: data,
      cwd,
      sessionKey: '66666666-6666-4666-8666-666666666666',
      approvalMode: 'all',
      terminal: {
        kind: 'powershell',
        path: (await import('./fixtures/terminal.mjs')).getPowerShellConfig().shell
      }
    })
    await request('prompt', 'ELI_IMAGE_TEST')
    while (states.at(-1)?.snapshot.running || !states.at(-1)?.snapshot.messages.length)
      await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(states.at(-1).snapshot.error, null)
    const images = requestImages(requests.at(-1))
    assert.equal(images.length, 1)
    const resized = nativeImage
      .createFromBuffer(Buffer.from(images[0].split(',')[1], 'base64'))
      .getSize()
    assert.ok(resized.width > 0 && resized.width <= 2000)
    assert.ok(resized.height > 0 && resized.height <= 2000)
    const beforeRecovery = requests.length
    rejectImageRequests = true
    states.length = 0
    await request('prompt', 'ELI_413_RECOVERY')
    while (states.at(-1)?.snapshot.running || !states.at(-1)?.snapshot.messages.length)
      await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(states.at(-1).snapshot.error, null)
    assert.equal(states.at(-1).snapshot.messages.at(-1).stopReason, 'stop')
    assert.equal(requests.length - beforeRecovery, 2)
    assert.equal(requestImages(requests[beforeRecovery]).length, 1)
    assert.equal(requestImages(requests[beforeRecovery + 1]).length, 0)
    assert.equal(
      states.at(-1).snapshot.requestBodyBytes,
      Buffer.byteLength(JSON.stringify(requests[beforeRecovery + 1]))
    )
    assert.match(JSON.stringify(requests[beforeRecovery + 1]), /已省略此处的图片或文档/)
    rejectImageRequests = false
    const beforeCompaction = requests.length
    states.length = 0
    await request('compact')
    while (
      !states.at(-1) ||
      states.at(-1).snapshot.running ||
      (states.at(-1).snapshot.activity !== '上下文压缩完成' && !states.at(-1).snapshot.error)
    )
      await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(states.at(-1).snapshot.error, null)
    assert.equal(states.at(-1).snapshot.activity, '上下文压缩完成')
    assert.ok(requests.length > beforeCompaction)
    for (const body of requests.slice(beforeCompaction)) {
      assert.ok(
        body.messages.every(
          ({ content }) =>
            content === null ||
            typeof content === 'string' ||
            content.every(({ type }) => type === 'text')
        )
      )
      assert.doesNotMatch(JSON.stringify(body), /image_url|data:image/)
    }
    assert.deepEqual(readFileSync(imagePath), sourceImage)
    await request('shutdown')
    await imageSession.exited
    states.length = 0
    rejectImageRequests = false
    imageConfig.agent.codemode = { mode: 'only' }
    writeFileSync(join(data, 'config.json'), JSON.stringify(imageConfig))
    writeFileSync(join(cwd, 'program-fixture.txt'), 'ELI_PROGRAM_OK')
    const programSession = await startRuntime()
    await request('initialize', {
      kind: 'session',
      root: data,
      cwd,
      sessionKey: '77777777-7777-4777-8777-777777777777',
      approvalMode: 'all',
      terminal: {
        kind: 'powershell',
        path: (await import('./fixtures/terminal.mjs')).getPowerShellConfig().shell
      }
    })
    await request('prompt', 'ELI_PROGRAM_TEST')
    while (
      !states.some(
        ({ snapshot }) =>
          !snapshot.running &&
          (snapshot.error || snapshot.messages.some(({ role }) => role === 'toolResult'))
      )
    )
      await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(states.at(-1).snapshot.error, null)
    const program = states.at(-1).snapshot.messages.find(({ role }) => role === 'toolResult')
    assert.equal(program.isError, false, JSON.stringify(program.content))
    assert.match(JSON.stringify(program.content), /ELI_PROGRAM_OK/)
    await request('shutdown')
    await programSession.exited
    assert.ok(directory.startsWith(`${temporary}\\`) || directory.startsWith(`${temporary}/`))
    console.log(
      `Electron utilityProcess + dsh + MCP / skills + Cordis extensions + approvals + subagents + images / compaction + Codemode: PASS (${entry})`
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
