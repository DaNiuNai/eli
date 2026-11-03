import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { PluginApplication } from '../src/plugins/kernel.ts'
import { pluginResolver } from '../src/plugins/config.ts'
import { composePlugins, parsePluginConfiguration } from '../src/shared/plugins.ts'

test('用户安装的 ESM 插件按 import 导出条件从插件目录解析', async (t) => {
  const temporary = resolve('.tmp')
  await mkdir(temporary, { recursive: true })
  const root = await mkdtemp(join(temporary, 'plugin-package-'))
  const directory = join(root, 'plugins', 'node_modules', 'fixture-import-only')
  await mkdir(directory, { recursive: true })
  const app = new PluginApplication()
  t.after(async () => {
    await app.dispose()
    assert.ok(root.startsWith(temporary + '\\') || root.startsWith(temporary + '/'))
    await rm(root, { recursive: true, force: true })
  })
  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({ type: 'module', exports: { import: './entry.mjs' } })
  )
  await writeFile(
    join(directory, 'entry.mjs'),
    'export function apply(ctx) { ctx.provide("packageFixture", 42) }'
  )
  await app.start([{ id: 'fixture', name: 'fixture-import-only' }], pluginResolver(root, {}))
  assert.equal(app.ctx.get('packageFixture'), 42)
})

test('插件按服务依赖启动，注册及资源按依赖反序撤销', async () => {
  const app = new PluginApplication()
  const events = []
  const plugins = {
    consumer: {
      inject: ['fixture'],
      apply(ctx) {
        events.push(`use:${ctx.fixture.value}`)
        ctx.on('fixture/event', () => events.push('event'))
        ctx.effect(() => () => events.push('consumer-stop'))
      }
    },
    provider: {
      apply(ctx) {
        ctx.provide('fixture', { value: 42 })
        ctx.effect(() => () => events.push('provider-stop'))
      }
    }
  }
  await app.start(
    [
      { id: 'consumer', name: 'consumer' },
      { id: 'provider', name: 'provider' }
    ],
    (name) => plugins[name]
  )
  app.ctx.emit('fixture/event')
  assert.deepEqual(events, ['use:42', 'event'])
  await app.dispose()
  assert.deepEqual(events.slice(-2), ['consumer-stop', 'provider-stop'])
  assert.equal(app.ctx.get('fixture'), undefined)
  await app.dispose()
})

test('插件配置可替换实现和整份配置，禁用依赖时失败并清理已启动插件', async () => {
  const base = [
    { id: 'provider', name: 'original', config: { old: true } },
    { id: 'consumer', name: 'consumer' }
  ]
  const entries = composePlugins(base, [
    { id: 'provider', name: 'replacement', config: { value: 7 } }
  ])
  assert.deepEqual(entries[0], { id: 'provider', name: 'replacement', config: { value: 7 } })
  const app = new PluginApplication()
  let disposed = false
  await assert.rejects(
    app.start(
      [
        { id: 'first', name: 'first' },
        { id: 'missing', name: 'missing' }
      ],
      (name) =>
        name === 'first'
          ? {
              apply(ctx) {
                ctx.effect(() => () => {
                  disposed = true
                })
              }
            }
          : {
              inject: ['absent'],
              apply() {
                assert.fail('missing dependency must not activate')
              }
            }
    ),
    /依赖缺失或循环/
  )
  assert.equal(disposed, true)
  assert.throws(
    () => parsePluginConfiguration({ profiles: { client: [{ id: 'bad', disabled: 'false' }] } }),
    /格式无效/
  )
  assert.throws(() => composePlugins(base, [{ id: 'new' }]), /缺少模块/)
  assert.throws(() => composePlugins(base, [{ id: 'provider' }, { id: 'provider' }]), /重复/)
})
