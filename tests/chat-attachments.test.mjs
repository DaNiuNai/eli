import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, open, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  formatChatAttachmentMessage,
  maxChatFileBytes,
  parseChatAttachmentMessage
} from '../src/shared/chat-attachments.ts'
import { resolvePromptFiles, saveFileData } from '../src/main/chat-files.ts'

async function fixture(t) {
  const temporary = resolve('.tmp')
  await mkdir(temporary, { recursive: true })
  const directory = await mkdtemp(join(temporary, 'chat-attachments-'))
  t.after(async () => {
    assert.equal(dirname(directory), temporary)
    await rm(directory, { recursive: true, force: true })
  })
  return directory
}

test('图片和任意文件按顺序生成路径引用，特殊文件名可以从历史消息还原', () => {
  const paths = [
    'C:\\work\\图片.png',
    'C:\\work\\说明 [v2] (最终) #1 100%.pdf',
    'C:\\work\\README',
    'C:\\work\\另一张.jpg'
  ]
  const message = formatChatAttachmentMessage('  检查这些文件  ', paths)
  assert.equal(
    message,
    '[图片1]("C:\\work\\图片.png")\n' +
      '[说明 \\[v2\\] (最终) #1 100%.pdf]("C:\\work\\说明 [v2] (最终) #1 100%.pdf")\n' +
      '[README]("C:\\work\\README")\n' +
      '[图片4]("C:\\work\\另一张.jpg")\n\n检查这些文件'
  )
  const parsed = parseChatAttachmentMessage(message)
  assert.deepEqual(
    parsed.attachments.map(({ path }) => path),
    paths
  )
  assert.equal(parsed.text, '检查这些文件')
  assert.equal(parseChatAttachmentMessage(formatChatAttachmentMessage('', paths)).text, '')
})

test('兼容历史图片引用，普通链接和正文中的附件格式保持原样', () => {
  const history = '[图片1]("C:\\work\\a.png")\r\n[图片2]("C:\\work\\b.jpg")\r\n\r\n旧消息'
  assert.equal(parseChatAttachmentMessage(history).attachments.length, 2)
  assert.equal(parseChatAttachmentMessage(history).text, '旧消息')
  for (const message of [
    '[图片2]("C:\\work\\a.png")',
    '[文档]("C:\\work\\a.pdf")',
    '[a.pdf]("https://example.com/a.pdf")',
    '正文\n[a.pdf]("C:\\work\\a.pdf")'
  ]) {
    assert.deepEqual(parseChatAttachmentMessage(message), { attachments: [], text: message })
  }
})

test('发送普通文件、空文件、无扩展名文件和大文件时仅引用原路径', async (t) => {
  const directory = await fixture(t)
  const names = ['说明 [v2] (最终) #1 100%.pdf', 'archive.zip', 'README', 'empty', 'large.bin']
  for (const name of names) await writeFile(join(directory, name), '')
  const large = await open(join(directory, 'large.bin'), 'r+')
  await large.truncate(maxChatFileBytes + 1)
  await large.close()
  const expected = await Promise.all(names.map((name) => realpath(join(directory, name))))
  const paths = await resolvePromptFiles(
    [names[0], pathToFileURL(join(directory, names[1])).href, ...names.slice(2)],
    directory
  )
  assert.deepEqual(paths, expected)
  const parsed = parseChatAttachmentMessage(formatChatAttachmentMessage('', paths))
  assert.deepEqual(
    parsed.attachments.map(({ path }) => path),
    expected
  )
})

test('混合文件仍保留图片校验，拒绝目录、远程地址和无效列表', async (t) => {
  const directory = await fixture(t)
  const image = join(directory, 'image.png')
  await writeFile(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB', 'base64'))
  await writeFile(join(directory, 'fake.png'), 'not an image')
  await writeFile(join(directory, 'file.txt'), 'hello')
  assert.deepEqual(await resolvePromptFiles(['file.txt', 'image.png'], directory), [
    await realpath(join(directory, 'file.txt')),
    await realpath(image)
  ])
  await assert.rejects(resolvePromptFiles(['fake.png'], directory), /文件不是支持的图片/)
  await assert.rejects(resolvePromptFiles([directory], directory), /请选择本机文件/)
  await assert.rejects(resolvePromptFiles(['https://example.com/a.pdf'], directory), /只支持本机/)
  await assert.rejects(resolvePromptFiles(['missing.txt'], directory), /ENOENT/)
  await assert.rejects(resolvePromptFiles([123], directory), /无效的附件列表/)
})

test('无本地路径的文件保留名称和字节，同名文件互不覆盖，空文件也可保存', async (t) => {
  const directory = await fixture(t)
  const bytes = Uint8Array.from([0, 255, 128, 1])
  const first = await saveFileData('../payload.custom', bytes, directory)
  const second = await saveFileData('payload.custom', new Uint8Array(), directory)
  assert.equal(basename(first), 'payload.custom')
  assert.equal(dirname(dirname(first)), directory)
  assert.notEqual(first, second)
  assert.deepEqual(await readFile(first), Buffer.from(bytes))
  assert.equal((await readFile(second)).length, 0)
  await assert.rejects(saveFileData('..', bytes, directory), /无效的文件名/)
  await assert.rejects(saveFileData('a.txt', 'text', directory), /无效的文件数据/)
  await assert.rejects(
    saveFileData('large.bin', new Uint8Array(maxChatFileBytes + 1), directory),
    /文件超过 32 MB/
  )
})
