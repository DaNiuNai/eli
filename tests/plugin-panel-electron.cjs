const { app, BrowserWindow, dialog } = require('electron')
const assert = require('node:assert/strict')
const { homedir } = require('node:os')
const { mkdirSync, writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { setTimeout: delay } = require('node:timers/promises')

const [root, project] = process.argv.slice(2)
assert.equal(resolve(homedir()), resolve(root))
const plugin = join(root, 'decoration')
mkdirSync(plugin)
for (const [file, content] of Object.entries({
  'package.json': JSON.stringify({
    name: 'eli-test-decoration',
    version: '1.0.0',
    type: 'module',
    exports: { '.': './index.js', './client': './client.js' },
    dsh: {
      bundle: { patch: './cordis.patch.yml' },
      client: {
        platform: 'web',
        immediately: true,
        inject: ['@deepseek-ai/dsh-client-ui-conversation']
      }
    }
  }),
  'cordis.patch.yml': '- insert:\n    - id: decoration\n      name: eli-test-decoration\n',
  'index.js': 'export function apply(ctx){ctx.provide("fixtureDecoration",true)}',
  'client.js': `window.__ModuleLoader__.load({id:'eli-test-decoration',factory(require){
    const React=require('react')
    if(!require('@deepseek-ai/dsh-client-ui-primitives').Button)throw Error('missing dsh UI primitives')
    return { inject:['slots','locale'], apply(ctx){
      ctx.effect(()=>ctx.locale.register('fixture',{zh:{title:'装饰'},en:{title:'Decoration'}}))
      ctx.slots.inject('conversation.composer.dock',()=>ctx.slots.register({name:'conversation.composer.dock',id:'fixture-decoration',order:5,locale:'fixture'},({sessionId,useSession,useProjection,t})=>{
        const id=useSession(s=>s.sessionId);useProjection('eli.fixture')
        return React.createElement('output',{id:'fixture-decoration',title:t('title')},id===sessionId?id:'wrong session')
      }))
    } }
  }})`
}))
  writeFileSync(join(plugin, file), content)
app.setPath('userData', root)
app.setPath('documents', root)
app.setAppPath(project)
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [plugin] })
if (project.endsWith('.asar')) {
  Object.defineProperty(app, 'isPackaged', { value: true })
  Object.defineProperty(process, 'resourcesPath', { value: require('node:path').dirname(project) })
}
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-background-networking')
BrowserWindow.prototype.show = function () {
  /* 自动集成测试窗口保持隐藏。 */
}
dialog.showErrorBox = (title, message) => {
  console.error(title, message)
  app.exit(1)
}
dialog.showMessageBox = async (_window, request) => ({
  response: request.detail?.includes(plugin) ? 1 : 0
})
const deadline = setTimeout(() => {
  console.error('Plugin panel test timed out')
  app.exit(1)
}, 55000)
const created = new Promise((resolve) =>
  app.once('browser-window-created', (_e, window) => resolve(window))
)
async function run() {
  await import(pathToFileURL(join(project, 'out/main/index.mjs')).href)
  const window = await created
  const contents = window.webContents
  const errors = []
  contents.on('console-message', (_e, details) => {
    if (details.level === 'error') errors.push(details.message)
  })
  await new Promise((resolve) => contents.once('did-finish-load', resolve))
  async function wait(expression) {
    for (let i = 0; i < 160; i++) {
      const value = await contents.executeJavaScript(expression)
      if (value) return value
      await delay(100)
    }
    throw Error(
      'Missing ' +
        expression +
        '; ' +
        (await contents.executeJavaScript('document.body.innerText.slice(0,500)')) +
        ' ' +
        errors.join('\n')
    )
  }
  await wait("document.querySelector('.desktop-shell') !== null")
  await contents.executeJavaScript(
    "window.dispatchEvent(new KeyboardEvent('keydown',{key:',',ctrlKey:true}))"
  )
  await wait(
    '[...document.querySelectorAll(\'[role=tab]\')].find(el=>/插件管理|Plugins/.test(el.textContent))?.click() || !!document.querySelector(\'input[aria-label="搜索插件"],input[aria-label="Search plugins"]\')'
  )
  const session = await contents.executeJavaScript(
    'window.api.connect().then(s=>s.session?.sessionId)'
  )
  assert.ok(session)
  const change = (action) =>
    contents.executeJavaScript('window.plugins.change(' + JSON.stringify(action) + ')')
  const clickText = (text) =>
    contents.executeJavaScript(
      "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===" +
        JSON.stringify(text) +
        ')?.click()'
    )
  await clickText('安装插件')
  await wait("!!document.getElementById('plugin-source')")
  await contents.executeJavaScript(
    'document.querySelector(\'[aria-label="选择本地插件目录"]\').click()'
  )
  await wait("document.getElementById('plugin-source')?.value")
  await clickText('继续安装')
  assert.equal(await wait("document.querySelector('#fixture-decoration')?.textContent"), session)
  await wait(
    '!!document.querySelector(\'[aria-label="启用插件 eli-test-decoration"]:not(:disabled)\')'
  )
  await contents.executeJavaScript(
    'document.querySelector(\'[aria-label="启用插件 eli-test-decoration"]\').click()'
  )
  await wait("!document.querySelector('#fixture-decoration')")
  await wait(
    '!!document.querySelector(\'[aria-label="启用插件 eli-test-decoration"]:not(:disabled)[aria-checked=false]\')'
  )
  await change({ kind: 'enable', name: 'eli-test-decoration', enabled: true })
  assert.equal(await wait("document.querySelector('#fixture-decoration')?.textContent"), session)
  await change({ kind: 'remove', name: 'eli-test-decoration' })
  await wait("!document.querySelector('#fixture-decoration')")
  assert.equal(
    await contents.executeJavaScript('window.api.connect().then(s=>s.session.sessionId)'),
    session
  )
  console.log(
    'Electron plugin manager: dual-half bundle hot-loaded into existing chat, disabled, re-enabled and removed'
  )
}
run().then(
  () => {
    clearTimeout(deadline)
    app.quit()
  },
  (error) => {
    console.error(error)
    app.exit(1)
  }
)
