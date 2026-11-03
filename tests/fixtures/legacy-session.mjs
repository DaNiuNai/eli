/* eslint-disable @typescript-eslint/explicit-function-return-type -- JavaScript 测试夹具。 */
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'

// 固定的已发布 pi v3 文件格式，仅用于验证无 SDK 的旧数据迁移。
export class LegacySessionWriter {
  static create(cwd, directory) {
    return new LegacySessionWriter(cwd, directory)
  }
  constructor(cwd, directory) {
    mkdirSync(directory, { recursive: true })
    this.path = join(directory, `${randomUUID()}.jsonl`)
    this.leaf = null
    writeFileSync(
      this.path,
      JSON.stringify({
        type: 'session',
        version: 3,
        id: randomUUID(),
        cwd,
        timestamp: new Date().toISOString()
      }) + '\n'
    )
  }
  append(type, value) {
    const id = randomUUID()
    appendFileSync(
      this.path,
      JSON.stringify({
        type,
        id,
        parentId: this.leaf,
        timestamp: new Date().toISOString(),
        ...value
      }) + '\n'
    )
    this.leaf = id
    return id
  }
  appendModelChange(provider, modelId) {
    return this.append('model_change', { provider, modelId })
  }
  appendMessage(message) {
    return this.append('message', { message })
  }
  getSessionFile() {
    return this.path
  }
}
