import assert from 'node:assert/strict'
import test from 'node:test'
import { TrajectoryIndex } from '../src/runtime/dsh/trajectory.ts'

function fixture() {
  const events = []
  const index = new TrajectoryIndex({
    get seq() {
      return events.length
    },
    eventAt: (seq) => events[seq]
  })
  return {
    index,
    append(type, data) {
      const seq = events.length
      events.push({ seq, time: 1000 + seq * 100, type, data })
      return seq
    }
  }
}

test('运行中的并行子工具按各自 ID 结算，重读不会重复记录或虚构耗时', () => {
  const { index, append } = fixture()
  append('turn/start', { turn: 2 })
  append('step/start', { turn: 2, step: 1 })
  const root = append('tool/call', { callId: 'root', name: 'run_code', arguments: '{}' })
  const args = { rootCallId: 'root', parentCallId: 'root', name: 'read', arguments: { path: 'a' } }
  const first = append('tool/ptc-dispatch-start', { ...args, subCallId: 'a' })
  const second = append('tool/ptc-dispatch-start', { ...args, subCallId: 'b' })
  const live = index.read({})
  assert.equal(live.rows[second].parentSeq, root)
  assert.equal(live.rows[second].status, 'open')
  assert.equal(live.rows[second].end, undefined)
  assert.equal(live.detail, undefined)
  append('tool/ptc-dispatch', { ...args, subCallId: 'b', isError: true, content: [] })
  append('tool/ptc-dispatch', { ...args, subCallId: 'a', isError: false, content: [] })
  append('tool/result', { message: { toolCallId: 'root', content: [] } })
  append('step/end', { turn: 2, step: 1 })
  append('turn/end', { turn: 2, reason: { kind: 'completed' } })
  const done = index.read({ selected: first })
  assert.equal(done.total, live.total)
  assert.equal(done.rows[first].end - done.rows[first].start, 300)
  assert.equal(done.rows[second].status, 'error')
  assert.deepEqual(
    done.detail.map((item) => item.value.subCallId),
    ['a', 'a']
  )
  assert.equal(live.rows[first].status, 'open')
})

test('还原会话后可分页读取旧记录，区分轮间压缩并保留模型用量', () => {
  const { index, append } = fixture()
  for (let i = 0; i < 70; i++)
    append('user/message', { content: [{ type: 'text', text: String(i) }] })
  const id = append('compaction/start', { compactionId: 'manual', turn: null })
  const usage = { inputTokens: 42, outputTokens: 6 }
  append('compaction/summary', { compactionId: 'manual', summary: [], usage })
  append('compaction/end', { compactionId: 'manual', turn: null })
  const tail = index.read({ selected: id })
  assert.equal(tail.rows.length, 60)
  assert.equal(tail.offset, 11)
  assert.equal(tail.rows.at(-1).turn, null)
  assert.deepEqual(tail.rows.at(-1).usage, usage)
  assert.equal(tail.detail.length, 3)
  assert.equal(index.read({ offset: 0 }).rows[0].seq, 0)
  assert.throws(() => index.read({ selected: -1 }), /轨迹位置/)
})
