import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { EliConfigStore } from '../src/config/store.ts'
import { SkillsService } from '../src/runtime/skills.ts'
import { AppConfig } from '../src/main/app-config.ts'
import { AgentSettingsService } from '../src/runtime/settings-service.ts'

async function fixture(t) {
  const temporary = resolve('.tmp')
  await mkdir(temporary, { recursive: true })
  const directory = await mkdtemp(join(temporary, 'skills-test-'))
  const root = join(directory, '.eli')
  await mkdir(root, { recursive: true })
  t.after(async () => {
    assert.ok(directory.startsWith(`${temporary}\\`) || directory.startsWith(`${temporary}/`))
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  return { directory, root, path: join(root, 'config.json'), service: new SkillsService(root) }
}

async function skill(directory, name, description = `${name} fixture`) {
  const path = join(directory, name, 'SKILL.md')
  const content = `---\nname: ${name}\ndescription: ${description}\n---\n${name} body\n`
  await mkdir(join(directory, name), { recursive: true })
  await writeFile(path, content)
  return { path, content }
}

test('用户级 Skill 完整发现后应用关闭配置，开关只写 config.json', async (t) => {
  const f = await fixture(t)
  const local = await skill(join(f.root, 'skills'), 'local')
  const shared = await skill(join(f.directory, '.agents/skills'), 'shared')
  const duplicate = await skill(join(f.directory, '.agents/skills'), 'local', 'shadowed fixture')
  const extra = await skill(join(f.root, 'extra-skills'), 'extra')
  await skill(join(f.directory, 'workspace/.agents/skills'), 'project-only')
  const store = new EliConfigStore(f.path)
  await store.update((config) => {
    config.agent.skills = ['extra-skills']
    config.agent.defaultThinkingLevel = 'high'
    config.providers.fixture = { name: 'Preserved' }
    config.credentials['api_key:fixture'] = { type: 'api_key', key: 'test-skill-secret' }
  })
  const before = await readFile(f.path, 'utf8')
  const all = await f.service.get()
  assert.deepEqual(
    all.map(({ name, enabled }) => [name, enabled]),
    [
      ['extra', true],
      ['local', true],
      ['shared', true]
    ]
  )
  assert.equal(await readFile(f.path, 'utf8'), before)
  assert.equal(JSON.stringify(all).includes('test-skill-secret'), false)
  const disabled = await f.service.setEnabled(local.path, false)
  assert.equal(disabled.find(({ name }) => name === 'local').enabled, false)
  assert.equal(disabled.find(({ name }) => name === 'local').description, 'local fixture')
  assert.equal(disabled.length, all.length)
  assert.deepEqual((await store.read()).disabledSkills, [local.path])
  // 应用偏好和 Agent 设置的写入也必须保留 Skill 的关闭状态。
  const app = new AppConfig(f.path)
  await app.load()
  await app.set({ ...app.get(), theme: 'dark' })
  await new AgentSettingsService(f.root).save([
    { key: 'defaultThinkingLevel', value: 'low', expected: 'high' }
  ])
  assert.equal(
    (await new SkillsService(f.root).get()).find(({ name }) => name === 'local').enabled,
    false
  )
  await Promise.all([
    f.service.setEnabled(shared.path, false),
    f.service.setEnabled(extra.path, false)
  ])
  assert.deepEqual(
    new Set((await store.read()).disabledSkills),
    new Set([local.path, shared.path, extra.path])
  )
  await f.service.setEnabled(local.path, true)
  await f.service.setEnabled(shared.path, true)
  const enabled = await f.service.setEnabled(extra.path, true)
  assert.ok(enabled.every(({ enabled }) => enabled))
  const saved = await store.read()
  assert.equal(saved.disabledSkills, undefined)
  assert.equal(saved.app.theme, 'dark')
  assert.equal(saved.agent.defaultThinkingLevel, 'low')
  assert.equal(saved.providers.fixture.name, 'Preserved')
  assert.equal(saved.credentials['api_key:fixture'].key, 'test-skill-secret')
  for (const file of [local, shared, duplicate, extra])
    assert.equal(await readFile(file.path, 'utf8'), file.content)
  assert.deepEqual((await readdir(f.root)).sort(), ['config.json', 'extra-skills', 'skills'])
})

test('Skill 管理拒绝无效参数和非用户级路径，校验关闭配置并保持原文件', async (t) => {
  const f = await fixture(t)
  const user = await skill(join(f.root, 'skills'), 'user')
  const project = await skill(join(f.directory, 'workspace/.eli/skills'), 'project')
  await f.service.setEnabled(user.path, false)
  const before = await readFile(f.path, 'utf8')
  for (const args of [
    [user.path, 'false'],
    [null, true],
    ['', true],
    [project.path, false]
  ])
    await assert.rejects(f.service.setEnabled(...args), /无效|不存在/)
  assert.equal(await readFile(f.path, 'utf8'), before)
  if (process.platform === 'win32') {
    await f.service.setEnabled(user.path.toUpperCase(), true)
    assert.equal((await f.service.get())[0].enabled, true)
  }
  for (const disabledSkills of ['skill', {}, [false], ['']]) {
    await writeFile(f.path, JSON.stringify({ disabledSkills }))
    await assert.rejects(f.service.get(), /无法读取 Eli 配置/)
  }
})
