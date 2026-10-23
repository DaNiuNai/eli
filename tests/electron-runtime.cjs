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
let nextId = 0
const pending = new Map()
const states = []
const requests = []

function request(method, ...args) {
  const id = String(++nextId)
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    child.postMessage({ version: 1, kind: 'request', id, agentId: 'main', method, args })
  })
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
        send({ content: JSON.stringify({ decision: 'allow', reason: '用户要求创建测试文件' }) })
        send({}, 'stop')
      } else if (body.messages.at(-1).role !== 'tool') {
        send({
          tool_calls: [
            {
              index: 0,
              id: 'electron-write',
              type: 'function',
              function: {
                name: 'write',
                arguments: JSON.stringify({ path: 'approved.txt', content: 'electron-approved' })
              }
            }
          ]
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
    child = utilityProcess.fork(entry, [], { serviceName: 'eli Runtime smoke test', stdio: 'pipe' })
    child.stdout.resume()
    child.stderr.on('data', (chunk) => process.stderr.write(chunk))
    const exited = new Promise((resolve) => child.once('exit', resolve))
    const ready = new Promise((resolve, reject) => {
      child.once('exit', (code) => reject(new Error(`Runtime exited: ${code}`)))
      child.on('message', (message) => {
        if (message.kind === 'session') states.push(message.state)
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
    await ready
    const state = await request('initialize', {
      kind: 'session',
      root: data,
      cwd,
      sessionKey: '55555555-5555-4555-8555-555555555555',
      approvalMode: 'auto',
      terminal: { kind: 'powershell', path: 'powershell.exe' }
    })
    assert.equal(state.snapshot.connection, 'ready')
    assert.equal(state.persistedFile, undefined)
    assert.deepEqual(await request('getSkills'), [])
    await request('prompt', '请在工作目录创建 approved.txt')
    while (
      !states.some((state) => !state.snapshot.running && state.snapshot.messages.length >= 4)
    ) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.equal(readFileSync(join(cwd, 'approved.txt'), 'utf8'), 'electron-approved')
    assert.ok(requests.some((body) => body.model === 'reviewer' && !body.tools?.length))
    assert.ok(states.every((state) => !state.snapshot.toolApprovals.length))
    await request('shutdown')
    await exited
    assert.deepEqual(JSON.parse(readFileSync(join(data, 'config.json'), 'utf8')), config)
    for (const name of ['settings.json', 'models.json', 'providers.json', 'auth.json'])
      assert.equal(existsSync(join(data, name)), false, `${name} must not be created`)
    assert.ok(directory.startsWith(`${temporary}\\`) || directory.startsWith(`${temporary}/`))
    console.log(
      `Electron utilityProcess + SDK + project extension + auto approval: PASS (${entry})`
    )
    server.closeAllConnections()
    server.close()
    clearTimeout(timeout)
    app.exit(0)
  } catch (error) {
    server?.closeAllConnections()
    server?.close()
    console.error(error)
    child?.kill()
    clearTimeout(timeout)
    app.exit(1)
  }
})
