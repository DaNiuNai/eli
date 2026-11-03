import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { PluginPackages } from '../src/plugins/packages.ts'
import { PluginManager } from '../src/plugins/manager.ts'
import { PluginApplication } from '../src/plugins/kernel.ts'
import { pluginProfile, pluginResolver } from '../src/plugins/config.ts'

const exec = promisify(execFile)
const pnpm = resolve('node_modules/pnpm/bin/pnpm.cjs')
test('从固定 Git 提交安装 dsh 隔离分组，用原版 Loader 计算 !!js 并卸载', async (t) => {
  const root = await fixture(t)
  const repository = join(root, 'git-source')
  await mkdir(repository)
  await writeFile(
    join(repository, 'package.json'),
    JSON.stringify({
      name: 'group-fixture',
      version: '1.0.0',
      type: 'module',
      exports: { '.': './index.js', './reader': './reader.js' },
      dsh: { bundle: { patch: './patch.yml' } }
    })
  )
  await writeFile(
    join(repository, 'index.js'),
    'export function apply(ctx,config){ctx.provide("inner",config.value)}'
  )
  await writeFile(
    join(repository, 'reader.js'),
    'export const inject=["inner"]; export function apply(ctx){ctx.provide("outer",ctx.inner)}'
  )
  await writeFile(
    join(repository, 'patch.yml'),
    [
      '- insert:',
      '    - id: group-fixture',
      '      name: cordis:group',
      '      group: true',
      '      isolate:',
      '        inner: true',
      '      config:',
      '        - id: read-inner',
      '          name: group-fixture/reader',
      '        - id: set-inner',
      '          name: group-fixture',
      '          config:',
      '            value: !!js process.platform'
    ].join('\n')
  )
  const git = (args) => exec('git', args, { cwd: repository })
  await git(['init', '--quiet'])
  await git(['add', '.'])
  await git([
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@localhost',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-qm',
    'fixture'
  ])
  const { stdout } = await git(['rev-parse', 'HEAD'])
  const remote = 'https://git.example.invalid/eli/group-fixture.git'
  const env = {
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'url.' + pathToFileURL(repository).href + '.insteadOf',
    GIT_CONFIG_VALUE_0: remote,
    GIT_CONFIG_KEY_1: 'protocol.file.allow',
    GIT_CONFIG_VALUE_1: 'always'
  }
  const original = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]))
  Object.assign(process.env, env)
  t.after(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
  const app = new PluginApplication()
  t.after(() => app.dispose())
  await app.startProfile(() => pluginProfile(root, 'session', []), pluginResolver(root, {}))
  const manager = new PluginManager(root, new PluginPackages(root, pnpm), async () => {
    await app.refresh()
    return 'applied'
  })
  await manager.change({
    kind: 'install',
    source: remote + '#' + stdout.trim(),
    profile: 'session'
  })
  assert.equal(app.ctx.get('outer'), process.platform, JSON.stringify(app.status()))
  assert.equal(app.ctx.get('inner'), undefined)
  await manager.change({ kind: 'remove', name: 'group-fixture' })
  assert.equal(app.ctx.get('outer'), undefined)
})
async function fixture(t) {
  const tmp = resolve('.tmp')
  await mkdir(tmp, { recursive: true })
  const root = await mkdtemp(join(tmp, 'plugin-management-'))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 }))
  return root
}
test('安装 npm 组合包、列出版本、在线切换和回退；激活失败恢复旧版，卸载撤销两端条目', async (t) => {
  const root = await fixture(t)
  const server = createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const registry = 'http://127.0.0.1:' + server.address().port + '/'
  const name = 'eli-example-extension'
  const metadata = { name, versions: {}, 'dist-tags': { latest: '2.0.0' } }
  const archives = new Map()
  for (const version of ['1.0.0', '2.0.0', '3.0.0']) {
    const dir = join(root, version),
      pkg = join(dir, 'package')
    await mkdir(pkg, { recursive: true })
    const manifest = {
      name,
      version,
      type: 'module',
      exports: { '.': './index.js', './client': './client.js' },
      dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } }
    }
    await writeFile(join(pkg, 'package.json'), JSON.stringify(manifest))
    await writeFile(
      join(pkg, 'cordis.patch.yml'),
      '- insert:\n    - id: fixture\n      name: ' + name + '\n'
    )
    await writeFile(
      join(pkg, 'index.js'),
      version === '3.0.0'
        ? 'export function apply(){throw Error("invalid fixture")}'
        : 'export function apply(ctx){ctx.provide("fixture",' + JSON.stringify(version) + ')}'
    )
    await writeFile(
      join(pkg, 'client.js'),
      'window.__ModuleLoader__.load({id:"fixture",factory:()=>({apply(){}})})'
    )
    await exec('tar', ['-czf', 'version.tgz', 'package'], { cwd: dir })
    const archive = await readFile(join(dir, 'version.tgz')),
      path = '/' + version + '.tgz'
    metadata.versions[version] = {
      ...manifest,
      dist: {
        tarball: registry + path.slice(1),
        integrity: 'sha512-' + createHash('sha512').update(archive).digest('base64')
      }
    }
    archives.set(path, archive)
  }
  server.on('request', (req, res) => {
    if (archives.has(req.url)) {
      res.end(archives.get(req.url))
      return
    }
    if (req.url === '/' + name) {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(metadata))
      return
    }
    res.writeHead(404)
    res.end('{}')
  })
  const app = new PluginApplication()
  t.after(() => app.dispose())
  const packages = new PluginPackages(root, pnpm, registry)
  const source = () => pluginProfile(root, 'session', [])
  await app.startProfile(source, pluginResolver(root, {}))
  const manager = new PluginManager(root, packages, async () => {
    await app.refresh()
    return 'applied'
  })
  await manager.change({ kind: 'install', source: name + '@1.0.0', profile: 'session' })
  assert.equal(app.ctx.get('fixture'), '1.0.0')
  assert.deepEqual(await manager.versions(name), ['3.0.0', '2.0.0', '1.0.0'])
  assert.match((await pluginProfile(root, 'client', []))[0].name, /client\.js$/)
  await manager.change({ kind: 'update', name, version: '2.0.0' })
  assert.equal(app.ctx.get('fixture'), '2.0.0')
  await assert.rejects(
    manager.change({ kind: 'update', name, version: '3.0.0' }),
    /invalid fixture/
  )
  assert.equal(app.ctx.get('fixture'), '2.0.0')
  assert.equal((await manager.list()).packages[0].version, '2.0.0')
  await manager.change({ kind: 'update', name, version: '1.0.0' })
  await manager.change({ kind: 'enable', name, enabled: false })
  assert.equal(app.ctx.get('fixture'), undefined)
  await manager.change({ kind: 'enable', name, enabled: true })
  assert.equal(app.ctx.get('fixture'), '1.0.0')
  await manager.change({ kind: 'remove', name })
  assert.equal(app.ctx.get('fixture'), undefined)
  assert.deepEqual(await pluginProfile(root, 'client', []), [])
  await manager.collect()
})
test('管理面板保护必需服务；启停保留手工配置及其他作用域', async (t) => {
  const root = await fixture(t)
  await writeFile(
    join(root, 'plugins.json'),
    JSON.stringify({
      profiles: {
        session: [{ id: 'terminal', config: { custom: true } }],
        desktop: [{ id: 'updates', disabled: true }]
      }
    })
  )
  const manager = new PluginManager(root, new PluginPackages(root, pnpm), async () => 'applied')
  await assert.rejects(
    manager.change({ kind: 'toggle', profile: 'client', id: 'ui-plugins', enabled: false }),
    /系统管理/
  )
  await manager.change({ kind: 'toggle', profile: 'session', id: 'terminal', enabled: false })
  const config = JSON.parse(await readFile(join(root, 'plugins.json'), 'utf8'))
  assert.deepEqual(config.profiles.session, [
    { id: 'terminal', config: { custom: true }, disabled: true }
  ])
  assert.deepEqual(config.profiles.desktop, [{ id: 'updates', disabled: true }])
  await manager.change({
    kind: 'configure',
    profile: 'session',
    id: 'terminal',
    config: { format: 'test' }
  })
  assert.deepEqual(
    (await manager.list()).entries.find((row) => row.profile === 'session' && row.id === 'terminal')
      .config,
    { format: 'test' }
  )
  await manager.change({ kind: 'configure', profile: 'session', id: 'terminal', config: null })
  assert.deepEqual(
    JSON.parse(await readFile(join(root, 'plugins.json'), 'utf8')).profiles.session,
    [{ id: 'terminal', disabled: true }]
  )
})
test('热重载拒绝断开其他插件的依赖，恢复原有服务和消费者', async (t) => {
  const app = new PluginApplication()
  t.after(() => app.dispose())
  const plugins = {
    provider: {
      apply(ctx) {
        ctx.provide('source', 7)
      }
    },
    consumer: {
      inject: ['source'],
      apply(ctx) {
        ctx.provide('computed', ctx.source + 1)
      }
    }
  }
  const entries = [
    { id: 'provider', name: 'provider' },
    { id: 'consumer', name: 'consumer' }
  ]
  await app.start(entries, (name) => plugins[name])
  await assert.rejects(app.reload([{ ...entries[0], disabled: true }, entries[1]]), /失去必需服务/)
  assert.equal(app.ctx.get('source'), 7)
  assert.equal(app.ctx.get('computed'), 8)
})
