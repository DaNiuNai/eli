import test from 'node:test'
import assert from 'node:assert/strict'
import {
  checkSkillInstallRequirements,
  commonSkillsInstallPrompt,
  SkillInstallationService
} from '../src/main/skill-installation.ts'

test('检测系统 Node.js/npm/npx，Windows 使用 cmd 脚本且只查询版本', async () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    const calls = []
    const ready = await checkSkillInstallRequirements(platform, async (file, args) => {
      calls.push([file, args])
      return file.startsWith('node') ? 'v24.0.0\n' : '11.0.0\r\n'
    })
    assert.equal(ready, true)
    assert.deepEqual(
      calls,
      platform === 'win32'
        ? [
            ['node.exe', ['--version']],
            ['cmd.exe', ['/d', '/s', '/c', 'npm.cmd --version']],
            ['cmd.exe', ['/d', '/s', '/c', 'npx.cmd --version']]
          ]
        : ['node', 'npm', 'npx'].map((command) => [command, ['--version']])
    )
  }
})

test('缺少任一工具、版本输出无效或 Node.js 过旧时阻止安装', async () => {
  for (const missing of ['node', 'npm', 'npx']) {
    assert.equal(
      await checkSkillInstallRequirements('linux', async (file) => {
        if (file === missing) throw new Error('ENOENT')
        return file === 'node' ? 'v24.0.0' : '11.0.0'
      }),
      false
    )
  }
  for (const [version, expected] of [
    ['v20.19.0', false],
    ['v22.19.0', false],
    ['v22.20.0', true],
    ['v24.0.0', true],
    ['', false],
    ['not a version', false]
  ]) {
    assert.equal(
      await checkSkillInstallRequirements('linux', async (file) =>
        file === 'node' ? version : '11.0.0'
      ),
      expected
    )
  }
  assert.equal(
    await checkSkillInstallRequirements('linux', async (file) =>
      file === 'node' ? 'v24.0.0' : 'invalid npm output'
    ),
    false
  )
})

test('缺少 Node.js 环境时仅打开官网，不创建会话或执行安装', async () => {
  const opened = []
  const service = new SkillInstallationService({
    checkRequirements: async () => false,
    openExternal: async (url) => opened.push(url),
    startSession: async () => assert.fail('不应创建会话')
  })
  assert.equal(await service.install(), 'node-required')
  assert.deepEqual(opened, ['https://nodejs.org/'])
})

test('环境可用时只向新会话发送六项用户级安装任务，并要求处理网络问题和验证结果', async () => {
  const prompts = []
  const service = new SkillInstallationService({
    checkRequirements: async () => true,
    openExternal: async () => assert.fail('不应打开官网'),
    startSession: async (prompt) => prompts.push(prompt)
  })
  assert.equal(await service.install(), 'started')
  assert.deepEqual(prompts, [commonSkillsInstallPrompt])
  const commands = prompts[0].split('\n').filter((line) => line.startsWith('npx '))
  assert.deepEqual(
    commands,
    ['find-skills', 'skill-creator', 'pdf', 'pptx', 'docx', 'xlsx'].map((skill, index) => {
      const repository = index === 0 ? 'vercel-labs/skills' : 'anthropics/skills'
      return `npx --yes skills add https://github.com/${repository} --skill ${skill} -g -a pi -y`
    })
  )
  assert.match(prompts[0], /nodejs\.org、npm registry 或 GitHub/)
  assert.match(prompts[0], /主动诊断网络、代理和镜像/)
  assert.match(prompts[0], /SKILL\.md/)
  assert.match(prompts[0], /重新加载/)
})

test('重复点击共用一次检测和会话，完成后可再次安装', async () => {
  let release
  const gate = new Promise((resolve) => (release = resolve))
  let checks = 0
  let sessions = 0
  const service = new SkillInstallationService({
    checkRequirements: async () => {
      checks++
      await gate
      return true
    },
    openExternal: async () => assert.fail('不应打开官网'),
    startSession: async () => sessions++
  })
  const first = service.install()
  const second = service.install()
  assert.equal(first, second)
  release()
  await first
  assert.equal(checks, 1)
  assert.equal(sessions, 1)
  await service.install()
  assert.equal(sessions, 2)
})

test('会话发送失败后可重试，浏览器打开失败提示手动下载和重启', async () => {
  let attempts = 0
  const service = new SkillInstallationService({
    checkRequirements: async () => true,
    openExternal: async () => assert.fail('不应打开官网'),
    startSession: async () => {
      if (++attempts === 1) throw new Error('会话创建失败')
    }
  })
  await assert.rejects(service.install(), /会话创建失败/)
  assert.equal(await service.install(), 'started')
  const missing = new SkillInstallationService({
    checkRequirements: async () => false,
    openExternal: async () => {
      throw new Error('浏览器不可用')
    },
    startSession: async () => assert.fail('不应创建会话')
  })
  await assert.rejects(missing.install(), /https:\/\/nodejs\.org\/.*重启应用/)
})
