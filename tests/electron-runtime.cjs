const { app, utilityProcess } = require('electron')
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } = require('node:fs')
const { join, resolve } = require('node:path')
const assert = require('node:assert/strict')

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
let nextId = 0
const pending = new Map()

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
    child = utilityProcess.fork(entry, [], { serviceName: 'eli Runtime smoke test', stdio: 'pipe' })
    child.stdout.resume()
    child.stderr.on('data', (chunk) => process.stderr.write(chunk))
    const exited = new Promise((resolve) => child.once('exit', resolve))
    const ready = new Promise((resolve, reject) => {
      child.once('exit', (code) => reject(new Error(`Runtime exited: ${code}`)))
      child.on('message', (message) => {
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
      approvalMode: 'request',
      terminal: { kind: 'powershell', path: 'powershell.exe' }
    })
    assert.equal(state.snapshot.connection, 'ready')
    assert.equal(state.persistedFile, undefined)
    assert.deepEqual(await request('getSkills'), [])
    await request('shutdown')
    await exited
    assert.deepEqual(JSON.parse(readFileSync(join(data, 'config.json'), 'utf8')), {
      agent: { cacheWarming: 'off' }
    })
    for (const name of ['settings.json', 'models.json', 'providers.json', 'auth.json'])
      assert.equal(existsSync(join(data, name)), false, `${name} must not be created`)
    assert.ok(directory.startsWith(`${temporary}\\`) || directory.startsWith(`${temporary}/`))
    console.log(`Electron utilityProcess + SDK + project extension: PASS (${entry})`)
    clearTimeout(timeout)
    app.exit(0)
  } catch (error) {
    console.error(error)
    child?.kill()
    clearTimeout(timeout)
    app.exit(1)
  }
})
