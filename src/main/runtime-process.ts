import { utilityProcess } from 'electron'
import { join } from 'node:path'
import { RuntimeConnection } from '../runtime/connection'
import type { RuntimeMessage } from '../shared/runtime'

export function startRuntimeProcess(
  event: (message: RuntimeMessage) => void,
  failed: (error: Error) => void
): RuntimeConnection {
  const child = utilityProcess.fork(join(import.meta.dirname, 'runtime.mjs'), [], {
    serviceName: 'eli Agent Runtime',
    stdio: 'pipe'
  })
  // stdout 属于扩展日志，绝不解析为协议。仅保留有限的 stderr 用于崩溃诊断。
  let stderr = ''
  child.stdout?.resume()
  child.stderr?.on('data', (data: Buffer) => {
    stderr = (stderr + data.toString('utf8')).slice(-8192)
  })
  return new RuntimeConnection(
    {
      send: (message) => child.postMessage(message),
      kill: () => {
        child.kill()
      },
      onMessage: (listener) => {
        child.on('message', listener)
      },
      onExit: (listener) => {
        child.once('exit', (code) =>
          listener(new Error(`Runtime 进程已退出 (${code})${stderr ? `：${stderr}` : ''}`))
        )
      }
    },
    event,
    failed
  )
}
