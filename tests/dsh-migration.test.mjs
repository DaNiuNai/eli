import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, rename, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createEngine } from '../src/runtime/dsh/engine.ts'
import { importLegacySession } from '../src/runtime/dsh/migration.ts'
import { projectTranscript } from '../src/runtime/dsh/messages.ts'
import { createEliModels } from '../src/runtime/models.ts'
import { createSettings } from '../src/runtime/settings.ts'
import { LegacySessionWriter } from './fixtures/legacy-session.mjs'
import { AgentLibraryService } from '../src/runtime/library.ts'

async function fixture(t) {
  const temporary = resolve('.tmp')
  await mkdir(temporary, { recursive: true })
  const root = await mkdtemp(join(temporary, 'dsh-migration-'))
  const models = await createEliModels(root)
  const engine = await createEngine({
    root,
    cwd: root,
    models,
    settings: await createSettings(root)
  })
  t.after(async () => {
    await engine.dispose()
    assert.ok(root.startsWith(temporary + '\\') || root.startsWith(temporary + '/'))
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  return { root, engine, models }
}

test('旧 pi 会话迁移后保留原文件、身份、消息和用量，并可由 dsh 完整重读', async (t) => {
  const { root, engine, models } = await fixture(t)
  const writer = LegacySessionWriter.create(root, join(root, 'sessions', 'legacy'))
  writer.appendModelChange('fixture', 'local')
  const messages = [
    {
      role: 'user',
      content: [{ type: 'text', text: '保留这条原始消息' }],
      timestamp: 1700000000000
    },
    {
      role: 'assistant',
      content: [{ type: 'text', text: '历史回复' }],
      api: 'openai-completions',
      provider: 'fixture',
      model: 'local',
      stopReason: 'stop',
      timestamp: 1700000001000,
      usage: {
        input: 10,
        output: 2,
        cacheRead: 3,
        cacheWrite: 0,
        totalTokens: 15,
        cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 }
      }
    }
  ]
  for (const message of messages) writer.appendMessage(message)
  const original = await readFile(writer.path)
  const id = await importLegacySession(engine.ctx, writer.path)
  assert.equal(await importLegacySession(engine.ctx, writer.path), id)
  assert.deepEqual(await readFile(writer.path), original)
  const handle = await engine.ctx.sessionPersistence.open(id, 'read')
  try {
    const { events } = await handle.read()
    assert.equal(handle.header.id, JSON.parse(original.toString().split('\n')[0]).id)
    assert.deepEqual(
      projectTranscript(
        events,
        engine.ctx.attachments,
        models.runtime.getModel.bind(models.runtime)
      ).messages,
      messages
    )
  } finally {
    await handle.close()
  }
  const resumed = await engine.ctx.agents.resume({ resumeSessionId: id })
  assert.equal(
    resumed.agent.session.deriveMessages().filter(({ role }) => role === 'user').length,
    1
  )
  await resumed.dispose()
  const library = new AgentLibraryService(join(root, 'sessions'), engine.ctx.sessionPersistence)
  const migrated = await library.load()
  assert.equal(migrated.sessions.length, 1)
  assert.equal(migrated.requests[0].cost, 0.3)
  assert.notEqual(migrated.sessions[0].path, writer.path)
  await rename(migrated.sessions[0].path, join(root, 'trashed.jsonl'))
  assert.equal((await library.load(2)).sessions.length, 0)
  assert.deepEqual(await readFile(writer.path), original)
})

test('无版本的线性会话与 v2 扩展消息均可迁移，损坏的内部记录不会发布新会话', async (t) => {
  const { root, engine } = await fixture(t)
  for (const version of [1, 2]) {
    const id = `fixture-v${version}`
    const path = join(root, `${id}.jsonl`)
    const header = {
      type: 'session',
      id,
      cwd: root,
      timestamp: new Date().toISOString(),
      ...(version === 2 ? { version } : {})
    }
    const message = {
      role: 'hookMessage',
      customType: 'note',
      content: '旧插件消息',
      display: true,
      timestamp: Date.now()
    }
    const raw =
      [
        header,
        { type: 'message', message, ...(version === 2 ? { id: 'old', parentId: null } : {}) }
      ]
        .map((entry) => JSON.stringify(entry))
        .join('\n') + '\n'
    await writeFile(path, raw)
    assert.equal(await importLegacySession(engine.ctx, path), id)
    const handle = await engine.ctx.sessionPersistence.open(id, 'read')
    try {
      assert.equal(
        projectTranscript((await handle.read()).events, engine.ctx.attachments, () => undefined)
          .messages[0].role,
        'custom'
      )
    } finally {
      await handle.close()
    }
    assert.equal(await readFile(path, 'utf8'), raw)
  }
  const broken = join(root, 'broken.jsonl')
  const source =
    JSON.stringify({
      type: 'session',
      version: 3,
      id: 'broken',
      cwd: root,
      timestamp: new Date().toISOString()
    }) + '\n{ broken\n'
  await writeFile(broken, source)
  await assert.rejects(importLegacySession(engine.ctx, broken), /第 2 行/)
  assert.equal(await engine.ctx.sessionPersistence.stat('broken'), undefined)
  assert.equal(await readFile(broken, 'utf8'), source)
})
