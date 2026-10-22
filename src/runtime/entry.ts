import { RuntimeHost } from './host'
import { runtimeProtocolVersion, type RuntimeMessage } from '../shared/runtime'
import { existsSync } from 'node:fs'

// Electron utilityProcess 与 Node 回归测试共用入口，消息不经过 stdout。
const parent = process.parentPort
function send(message: RuntimeMessage): void {
  // 剔除 SDK 或扩展对象中的方法，避免将运行时对象交给 renderer。
  const plain = JSON.parse(JSON.stringify(message)) as RuntimeMessage
  if (parent) parent.postMessage(plain)
  else process.send?.(plain)
}
const host = new RuntimeHost(send)
let closing = false
async function close(): Promise<void> {
  if (closing) return
  closing = true
  await host.close()
  process.exit(0)
}
async function receive(value: unknown): Promise<void> {
  const id =
    value && typeof value === 'object' && 'id' in value && typeof value.id === 'string'
      ? value.id
      : ''
  try {
    const request = value as { method?: string; args?: { cwd?: string }[] }
    const cwd = request.method === 'initialize' ? request.args?.[0]?.cwd : undefined
    if (typeof cwd === 'string' && existsSync(cwd)) process.chdir(cwd)
    const result = await host.handle(value)
    send({ version: runtimeProtocolVersion, kind: 'response', id, ok: true, result })
    if ((value as { method?: string }).method === 'shutdown') await close()
  } catch (error) {
    send({
      version: runtimeProtocolVersion,
      kind: 'response',
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}
if (parent) {
  parent.on('message', ({ data }) => {
    void receive(data)
  })
} else if (process.send) {
  process.on('message', (value) => {
    void receive(value)
  })
  process.on('disconnect', () => {
    void close()
  })
} else throw new Error('Runtime 只能由 eli 启动')
process.on('SIGTERM', () => {
  void close()
})
process.on('uncaughtException', (error) => {
  send({ version: runtimeProtocolVersion, kind: 'fatal', error: error.message })
  void close()
})
process.on('unhandledRejection', (error) => {
  send({ version: runtimeProtocolVersion, kind: 'fatal', error: String(error) })
  void close()
})
send({ version: runtimeProtocolVersion, kind: 'ready' })
