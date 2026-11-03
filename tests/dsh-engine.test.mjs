import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { RuntimeHost } from '../src/runtime/host.ts'
import { createEngine } from '../src/runtime/dsh/engine.ts'
import { createEliModels } from '../src/runtime/models.ts'
import { RuntimeSettings } from '../src/runtime/settings.ts'

async function environment() {
  const temporary = resolve('.tmp')
  await mkdir(temporary, { recursive: true })
  const root = await mkdtemp(join(temporary, 'dsh-engine-'))
  const cwd = join(root, 'workspace')
  await mkdir(cwd)
  return {
    root,
    cwd,
    async remove() {
      assert.ok(root.startsWith(temporary + '\\') || root.startsWith(temporary + '/'))
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  }
}

test('通过用户配置替换模型适配器并禁用终端，Runtime 可以选择新模型并流式回复', async (t) => {
  const f = await environment()
  const updates = []
  const host = new RuntimeHost((message) => {
    if (message.kind === 'session') updates.push(structuredClone(message.state.snapshot))
  })
  t.after(async () => {
    await host.close()
    await f.remove()
  })
  await writeFile(
    join(f.root, 'models.mjs'),
    `import { LlmAdapter } from '@deepseek-ai/dsh-llm'
export const inject = ['llm']
export function apply(ctx) {
  class Fixture extends LlmAdapter {
    async listModels() { return [{ provider: 'fixture', id: 'local', name: 'Local' }] }
    async resolveModel() { return { provider: 'fixture', id: 'local', name: 'Local', context: { contextWindow: 2048 } } }
    async *stream(options) {
      const text = options.tools.map(tool => tool.name).join(',')
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      await new Promise(resolve => setTimeout(resolve, 100))
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.effect(() => ctx.llm.registerAdapter(['fixture'], new Fixture()))
}`
  )
  await writeFile(
    join(f.root, 'plugins.json'),
    JSON.stringify({
      version: 1,
      profiles: {
        session: [
          { id: 'models', name: './models.mjs', config: {} },
          { id: 'terminal', disabled: true }
        ]
      }
    })
  )
  const call = (method, ...args) =>
    host.handle({
      version: 1,
      kind: 'request',
      id: crypto.randomUUID(),
      agentId: 'main',
      method,
      args
    })
  const state = await call('initialize', {
    kind: 'session',
    root: f.root,
    cwd: f.cwd,
    sessionKey: crypto.randomUUID(),
    approvalMode: 'request',
    terminal: { kind: 'powershell', path: 'pwsh.exe' }
  })
  assert.equal(state.snapshot.model.provider, 'fixture')
  await call('prompt', 'inspect tools')
  const end = Date.now() + 5000
  while (
    !updates.some(
      (snapshot) => !snapshot.running && snapshot.messages.at(-1)?.role === 'assistant'
    ) &&
    Date.now() < end
  )
    await delay(10)
  const reply = updates.at(-1).messages.at(-1).content[0].text.split(',')
  assert.ok(reply.includes('read'))
  assert.ok(!reply.includes('powershell') && !reply.includes('get_task'))
  assert.ok(updates.some((snapshot) => snapshot.running && snapshot.response.phase === 'text'))
})

test('dsh 程序执行器将嵌套工具交给同一审批流水线', async (t) => {
  const f = await environment()
  const app = await createEngine({
    root: f.root,
    cwd: f.cwd,
    models: await createEliModels(f.root),
    settings: new RuntimeSettings({ codemode: { mode: 'only' } })
  })
  t.after(async () => {
    await app.dispose()
    await f.remove()
  })
  const { agent } = await app.ctx.agents.create({
    sessionId: SessionId(crypto.randomUUID()),
    meta: { cwd: f.cwd }
  })
  let executions = 0
  app.ctx.tools.register({
    name: 'fixture_echo',
    description: 'echo',
    parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }]
    },
    execute: async (args) => {
      executions++
      return args.value
    }
  })
  app.ctx.on('tools/pre-execute', (execution, next) =>
    execution.name === 'fixture_echo' && execution.arguments.value === 'deny'
      ? Promise.resolve({ kind: 'deny', reason: 'fixture denial' })
      : next()
  )
  const run = (value) =>
    app.ctx.tools.execute({
      agent,
      calls: [
        {
          type: 'tool-call',
          id: ToolCallId(crypto.randomUUID()),
          name: 'run_code',
          arguments: JSON.stringify({
            code: `return await tools.fixture_echo({value:${JSON.stringify(value)}})`,
            description: 'test nested dispatch'
          })
        }
      ],
      signal: AbortSignal.timeout(20000)
    })
  assert.equal((await run('allowed')).results[0].result.value.result, 'allowed')
  assert.equal((await run('deny')).results[0].result.isError, true)
  assert.equal(executions, 1)
})
