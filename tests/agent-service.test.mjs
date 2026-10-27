import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { agentChannels } from '../src/shared/agent.ts'
import { BrowserWindow, dialog, fixture, ipcMain } from './fixtures/agent-service-electron.mjs'

const electronFixture = new URL('./fixtures/agent-service-electron.mjs', import.meta.url).href
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') return { url: electronFixture, shortCircuit: true }
    return nextResolve(specifier, context)
  }
})
const { AgentService } = await import('../src/main/agent-service.ts')

async function harness(t) {
  const temporary = resolve('.tmp')
  await mkdir(temporary, { recursive: true })
  const directory = await mkdtemp(join(temporary, 'agent-service-'))
  const terminal = join(directory, 'powershell.exe')
  await writeFile(terminal, 'terminal fixture')
  fixture.runtimes.length = 0
  fixture.library.sessions = []
  dialog.calls.length = 0
  dialog.result = { canceled: true, filePaths: [] }
  const window = new BrowserWindow()
  const service = new AgentService(
    window,
    false,
    () => 'request',
    () => ({
      kind: 'powershell',
      path: terminal
    })
  )
  service.register()
  t.after(async () => {
    await service.dispose()
    assert.ok(directory.startsWith(temporary + '\\') || directory.startsWith(temporary + '/'))
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  const invoke = (channel, ...args) =>
    ipcMain.handlers.get(channel)(
      { sender: window.webContents, senderFrame: window.webContents.mainFrame },
      ...args
    )
  return { service, window, directory, invoke }
}

test('启动和重新连接保持未选目录，不创建会话或弹出选择框', async (t) => {
  const { service, invoke } = await harness(t)
  for (const restart of [false, true]) {
    const snapshot = await service.connect(restart)
    assert.equal(snapshot.connection, 'ready')
    assert.equal(snapshot.cwd, '')
    assert.equal(snapshot.session, null)
    assert.equal(snapshot.sessionKey, '')
    assert.deepEqual(snapshot.liveSessions, [])
    assert.deepEqual(snapshot.unavailableWorkspaces, [])
  }
  assert.deepEqual(
    fixture.runtimes.map((runtime) => runtime.options.kind),
    ['control']
  )
  assert.equal(dialog.calls.length, 0)
  await assert.rejects(invoke(agentChannels.newSession), /请先选择工作目录/)
  await assert.rejects(invoke(agentChannels.newSession, ''), /请先选择工作目录/)
})

test('取消目录选择保持空状态，选定目录后创建会话并发布快照', async (t) => {
  const { service, window, directory, invoke } = await harness(t)
  await service.connect()
  assert.equal(await invoke(agentChannels.chooseDirectory, 'zh-CN'), undefined)
  assert.equal(dialog.calls[0].defaultPath, undefined)
  assert.equal((await service.connect()).session, null)
  dialog.result = { canceled: false, filePaths: [directory] }
  assert.equal(await invoke(agentChannels.chooseDirectory, 'zh-CN'), directory)
  const selected = await service.connect()
  assert.equal(selected.cwd, directory)
  assert.ok(selected.session?.sessionId)
  assert.ok(selected.sessionKey)
  assert.deepEqual(
    fixture.runtimes.map((runtime) => runtime.options.kind),
    ['control', 'session']
  )
  await delay(50)
  assert.equal(window.webContents.sent.at(-1).snapshot.cwd, directory)
})

test('未选目录时可直接打开历史会话，并在该目录中新建对话', async (t) => {
  const { service, directory, invoke } = await harness(t)
  fixture.library.sessions = [{ path: join(directory, 'saved.jsonl'), cwd: directory }]
  await service.connect()
  await invoke(agentChannels.openSession, fixture.library.sessions[0].path)
  const opened = await service.connect()
  assert.equal(opened.cwd, directory)
  assert.equal(opened.session.sessionFile, fixture.library.sessions[0].path)
  await invoke(agentChannels.newSession, directory)
  assert.notEqual((await service.connect()).sessionKey, opened.sessionKey)
})

test('未选目录时可读取历史列表，并直接在历史工作目录中新建对话', async (t) => {
  const { service, directory, invoke } = await harness(t)
  fixture.library.sessions = [{ path: join(directory, 'saved.jsonl'), cwd: directory }]
  assert.equal((await service.connect()).session, null)
  assert.deepEqual((await invoke(agentChannels.getLibrary)).sessions, fixture.library.sessions)
  assert.equal(fixture.runtimes.length, 1)
  await invoke(agentChannels.newSession, directory)
  assert.equal((await service.connect()).cwd, directory)
})

test('未选目录时仍发布设置变化，缺少工作目录的历史会话不会隐式选用其他路径', async (t) => {
  const { service, window, directory, invoke } = await harness(t)
  await service.connect()
  service.refreshApprovalMode()
  await delay(50)
  assert.equal(window.webContents.sent.at(-1).snapshot.session, null)
  fixture.library.sessions = [{ path: join(directory, 'legacy.jsonl'), cwd: '' }]
  await assert.rejects(
    invoke(agentChannels.openSession, fixture.library.sessions[0].path),
    /请先选择工作目录/
  )
  assert.equal(fixture.runtimes.length, 1)
})
