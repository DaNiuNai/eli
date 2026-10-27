import test from 'node:test'
import assert from 'node:assert/strict'
import { buildChatEntries } from '../src/renderer/src/lib/chat-entries.ts'

const user = (text) => ({ role: 'user', content: text, timestamp: 1 })
const assistant = (text, stopReason = 'stop', parts = []) => ({
  role: 'assistant',
  content: [{ type: 'text', text }, ...parts],
  stopReason
})
const wait = {
  type: 'toolCall',
  id: 'wait',
  name: 'wait_agent',
  arguments: {}
}
const collaboration = {
  role: 'custom',
  customType: 'eli.collaboration',
  display: true,
  timestamp: 1,
  content: 'internal envelope',
  details: { sender: '/root/worker', text: '子任务完成' }
}

test('任务完成后，协作通知之间的过程消息仍不作为最终回复', () => {
  const entries = buildChatEntries([
    user('执行任务'),
    assistant('开始等待子任务', 'toolUse', [wait]),
    { role: 'toolResult', toolCallId: 'wait', content: [], isError: false },
    collaboration,
    assistant('继续等待其余成员', 'toolUse', [wait]),
    collaboration,
    assistant('全部任务已完成')
  ])

  assert.deepEqual(
    entries.filter((entry) => entry.isFinalResponse).map((entry) => entry.groups.at(-1).text),
    ['全部任务已完成']
  )
  assert.equal(entries.filter((entry) => entry.role === 'assistant').length, 5)
})

test('普通正文后仍有协作通知时，该正文也属于任务过程', () => {
  const entries = buildChatEntries([user('执行任务'), assistant('第一步完成'), collaboration])

  assert.ok(entries.every((entry) => !entry.isFinalResponse))
})

test('后续用户请求不影响历史任务的最终回复', () => {
  const entries = buildChatEntries([
    user('第一个任务'),
    assistant('第一个任务完成'),
    user('第二个任务'),
    assistant('正在处理', 'toolUse', [wait]),
    collaboration,
    assistant('第二个任务完成')
  ])

  assert.deepEqual(
    entries.filter((entry) => entry.isFinalResponse).map((entry) => entry.groups.at(-1).text),
    ['第一个任务完成', '第二个任务完成']
  )
})

test('工具调用、错误、中断和空占位均不作为最终回复', () => {
  for (const message of [
    assistant('继续处理', 'toolUse', [wait]),
    assistant('继续处理', 'stop', [wait]),
    assistant('部分内容', 'error'),
    assistant('部分内容', 'aborted'),
    assistant('')
  ]) {
    const entries = buildChatEntries([user('执行任务'), message])
    assert.ok(entries.every((entry) => !entry.isFinalResponse))
  }

  const entries = buildChatEntries([user('执行任务'), assistant('达到长度限制的回复', 'length')])
  assert.equal(entries.at(-1).isFinalResponse, true)
})
