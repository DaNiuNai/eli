import test from 'node:test'
import assert from 'node:assert/strict'
import { shareSnapshot } from '../src/renderer/src/lib/share-snapshot.ts'

test('流式快照只替换变化分支，保留侧栏与已完成消息的引用', () => {
  const previous = {
    revision: 1,
    liveSessions: [{ key: 'session', running: true }],
    messages: [
      { role: 'user', content: '问题' },
      { role: 'assistant', content: '正在' }
    ],
    tools: {},
    unavailableWorkspaces: []
  }
  const incoming = structuredClone(previous)
  incoming.revision++
  incoming.messages[1].content += '回复'
  const result = shareSnapshot(previous, incoming)
  assert.notEqual(result, previous)
  assert.equal(result.liveSessions, previous.liveSessions)
  assert.equal(result.messages[0], previous.messages[0])
  assert.notEqual(result.messages[1], previous.messages[1])
  assert.equal(result.tools, previous.tools)
  assert.equal(result.unavailableWorkspaces, previous.unavailableWorkspaces)
  assert.equal(previous.messages[1].content, '正在')
  assert.equal(shareSnapshot(result, structuredClone(result)), result)
})

test('快照数组缩短、字段删除和 null 变化不会被误判为相同状态', () => {
  for (const [before, after] of [
    [[1, 2], [1]],
    [{ value: null }, { value: [] }],
    [{ optional: undefined }, {}],
    [{}, { optional: undefined }],
    [{ value: { nested: true } }, { value: null }]
  ]) {
    const saved = structuredClone(before)
    const result = shareSnapshot(before, after)
    assert.deepEqual(result, after)
    assert.notEqual(result, before)
    assert.deepEqual(before, saved)
  }
})
