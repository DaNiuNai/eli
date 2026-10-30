import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
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
  fixture.initialize = undefined
  fixture.documents = join(directory, '系统文档')
  fixture.models = ['initial', 'other'].map((id) => ({
    provider: 'fixture',
    id,
    contextWindow: 100_000,
    reasoning: true
  }))
  fixture.library.sessions = []
  dialog.calls.length = 0
  dialog.result = { canceled: true, filePaths: [] }
  const preferences = { defaultWorkingDirectory: null }
  const window = new BrowserWindow()
  const service = new AgentService(
    window,
    false,
    () => 'request',
    () => ({
      kind: 'powershell',
      path: terminal
    }),
    () => preferences.defaultWorkingDirectory
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
  return {
    service,
    window,
    directory,
    defaultDirectory: join(fixture.documents, 'eli'),
    preferences,
    invoke
  }
}

test('启动自动创建系统文档下的 eli 工作目录和会话，重连沿用同一会话且不弹选择框', async (t) => {
  const { service, defaultDirectory, invoke } = await harness(t)
  await assert.rejects(stat(defaultDirectory), { code: 'ENOENT' })
  const initial = await service.connect()
  assert.ok((await stat(defaultDirectory)).isDirectory())
  for (const restart of [false, true]) {
    const snapshot = await service.connect(restart)
    assert.equal(snapshot.connection, 'ready')
    assert.equal(snapshot.cwd, defaultDirectory)
    assert.ok(snapshot.session?.sessionId)
    assert.equal(snapshot.sessionKey, initial.sessionKey)
    assert.deepEqual(snapshot.models, fixture.models)
    assert.deepEqual(snapshot.model, fixture.models[0])
    assert.deepEqual(snapshot.liveSessions, [])
    assert.deepEqual(snapshot.unavailableWorkspaces, [])
  }
  assert.deepEqual(
    fixture.runtimes.map((runtime) => runtime.options.kind),
    ['control', 'session', 'session']
  )
  assert.equal(dialog.calls.length, 0)
  await invoke(agentChannels.newSession)
  const next = await service.connect()
  assert.equal(next.cwd, defaultDirectory)
  assert.notEqual(next.sessionKey, initial.sessionKey)
  await assert.rejects(invoke(agentChannels.newSession, ''), /请先选择工作目录/)
})

test('默认工作目录已存在时保留其中的文件，并可立即切换模型', async (t) => {
  const { service, defaultDirectory, invoke } = await harness(t)
  await mkdir(defaultDirectory, { recursive: true })
  const existingFile = join(defaultDirectory, '已有文件.txt')
  await writeFile(existingFile, '保留已有内容')
  const initial = await service.connect()
  await invoke(agentChannels.setModel, initial.sessionKey, 'fixture', 'other')
  const changed = await service.connect()
  assert.equal(changed.sessionKey, initial.sessionKey)
  assert.equal(changed.model.id, 'other')
  assert.equal(changed.cwd, defaultDirectory)
  assert.equal((await service.connect(true)).model.id, 'other')
  assert.equal(await readFile(existingFile, 'utf8'), '保留已有内容')
  assert.equal(dialog.calls.length, 0)
})

test('启动使用设置中的默认目录，修改设置不会切换当前会话或重连时的目录', async (t) => {
  const { service, directory, defaultDirectory, preferences, invoke } = await harness(t)
  const custom = join(directory, '自定义工作目录')
  preferences.defaultWorkingDirectory = custom
  const initial = await service.connect()
  assert.equal(initial.cwd, custom)
  assert.ok((await stat(custom)).isDirectory())
  await assert.rejects(stat(defaultDirectory), { code: 'ENOENT' })
  preferences.defaultWorkingDirectory = join(directory, '下次启动目录')
  const reconnected = await service.connect(true)
  assert.equal(reconnected.cwd, custom)
  assert.equal(reconnected.sessionKey, initial.sessionKey)
  await invoke(agentChannels.newSession)
  assert.equal((await service.connect()).cwd, custom)
  assert.equal(dialog.calls.length, 0)
})

test('取消目录选择保持默认会话，选定目录后创建会话并发布快照，重连保留用户目录', async (t) => {
  const { service, window, directory, defaultDirectory, invoke } = await harness(t)
  const initial = await service.connect()
  assert.equal(await invoke(agentChannels.chooseDirectory, 'zh-CN'), undefined)
  assert.equal(dialog.calls[0].defaultPath, defaultDirectory)
  assert.equal((await service.connect()).sessionKey, initial.sessionKey)
  dialog.result = { canceled: false, filePaths: [directory] }
  assert.equal(await invoke(agentChannels.chooseDirectory, 'zh-CN'), directory)
  const selected = await service.connect()
  assert.equal(selected.cwd, directory)
  assert.ok(selected.session?.sessionId)
  assert.ok(selected.sessionKey)
  assert.deepEqual(
    fixture.runtimes.map((runtime) => runtime.options.kind),
    ['control', 'session', 'session']
  )
  assert.equal((await service.connect(true)).cwd, directory)
  await delay(50)
  assert.equal(window.webContents.sent.at(-1).snapshot.cwd, directory)
})

test('启动后可直接打开历史会话，并在该目录中新建对话', async (t) => {
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

test(
  '慢会话初始化不占用导航队列，加载完成不会抢回用户已切走的页面',
  { timeout: 5000 },
  async (t) => {
    const { service, directory, invoke } = await harness(t)
    await service.connect()
    const path = join(directory, 'slow.jsonl')
    fixture.library.sessions = [{ path, cwd: directory }]
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    t.after(() => release())
    fixture.initialize = (options) => (options.sessionFile === path ? gate : undefined)
    await invoke(agentChannels.openSession, path)
    const loading = service.snapshot()
    assert.equal(loading.connection, 'connecting')
    assert.equal(loading.session.sessionFile, path)
    await invoke(agentChannels.newSession)
    const next = await service.connect()
    assert.notEqual(next.sessionKey, loading.sessionKey)
    assert.equal(next.connection, 'ready')
    release()
    await delay(50)
    assert.equal(service.snapshot().sessionKey, next.sessionKey)
    await invoke(agentChannels.openSession, path)
    assert.equal((await service.connect()).sessionKey, loading.sessionKey)
  }
)

test('后台 token 不重复发送当前会话正文，侧栏状态变化仍及时发布', async (t) => {
  const { service, window, invoke } = await harness(t)
  const initial = await service.connect()
  const background = fixture.runtimes.find((runtime) => runtime.options.kind === 'session')
  background.state.summary = {
    key: initial.sessionKey,
    path: 'fixture-session',
    id: initial.sessionKey,
    cwd: initial.cwd,
    title: '后台任务',
    created: 1,
    modified: 1,
    messageCount: 1,
    running: true,
    pending: false,
    approvalCount: 0,
    questionCount: 0,
    backgroundTaskCount: 0,
    subagentCount: 0
  }
  background.state.snapshot.running = true
  background.state.snapshot.messages = [
    { role: 'assistant', content: [{ type: 'text', text: '开始' }] }
  ]
  const emit = () =>
    background.emit('message', {
      version: 1,
      kind: 'session',
      agentId: 'main',
      state: structuredClone(background.state),
      libraryChanged: false
    })
  emit()
  await invoke(agentChannels.newSession)
  const selected = await service.connect()
  await delay(50)
  const count = window.webContents.sent.filter(
    ({ channel }) => channel === agentChannels.snapshot
  ).length
  for (let index = 0; index < 10; index++) {
    background.state.snapshot.messages[0].content[0].text += '回复'
    emit()
  }
  await delay(50)
  assert.equal(
    window.webContents.sent.filter(({ channel }) => channel === agentChannels.snapshot).length,
    count
  )
  background.state.summary.questionCount = 1
  emit()
  await delay(50)
  const published = window.webContents.sent.at(-1).snapshot
  assert.equal(published.sessionKey, selected.sessionKey)
  assert.deepEqual(published.messages, [])
  assert.equal(published.liveSessions[0].questionCount, 1)
})

test('默认会话可读取历史列表，并直接在历史工作目录中新建对话', async (t) => {
  const { service, directory, defaultDirectory, invoke } = await harness(t)
  fixture.library.sessions = [{ path: join(directory, 'saved.jsonl'), cwd: directory }]
  assert.equal((await service.connect()).cwd, defaultDirectory)
  assert.deepEqual((await invoke(agentChannels.getLibrary)).sessions, fixture.library.sessions)
  assert.equal(fixture.runtimes.length, 2)
  await invoke(agentChannels.newSession, directory)
  assert.equal((await service.connect()).cwd, directory)
})

test('默认会话发布设置变化，缺少工作目录的历史会话沿用当前默认目录', async (t) => {
  const { service, window, directory, defaultDirectory, invoke } = await harness(t)
  const initial = await service.connect()
  service.refreshApprovalMode()
  await delay(50)
  assert.equal(window.webContents.sent.at(-1).snapshot.sessionKey, initial.sessionKey)
  fixture.library.sessions = [{ path: join(directory, 'legacy.jsonl'), cwd: '' }]
  await invoke(agentChannels.openSession, fixture.library.sessions[0].path)
  const opened = await service.connect()
  assert.equal(opened.cwd, defaultDirectory)
  assert.equal(opened.session.sessionFile, fixture.library.sessions[0].path)
  assert.equal(fixture.runtimes.length, 3)
})
