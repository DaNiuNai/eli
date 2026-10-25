import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
  writeSync
} from 'node:fs'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type { BashOperations } from '@earendil-works/pi-coding-agent'
import { isTaskActive, type BackgroundTask } from '../shared/background-tasks'

const outputLimit = 32 * 1024
const logLimit = 10 * 1024 * 1024
const taskLimit = 100
const activeLimit = 16

interface RunningTask {
  controller: AbortController
  done: Promise<void>
}

/** 每个会话独立持有进程；聊天轮次结束不影响已经返回句柄的任务。 */
export class BackgroundTasks {
  private readonly tasks = new Map<string, BackgroundTask>()
  private readonly running = new Map<string, RunningTask>()
  private readonly directory: string
  private closed = false
  private publishTimer?: ReturnType<typeof setTimeout>

  constructor(
    root: string,
    sessionId: string,
    private readonly changed: () => void
  ) {
    this.directory = join(
      root,
      'background-tasks',
      createHash('sha256').update(sessionId).digest('hex')
    )
    if (!existsSync(this.directory)) return
    for (const file of readdirSync(this.directory)) {
      if (!/^[\da-f-]{36}\.json$/.test(file)) continue
      const task = JSON.parse(readFileSync(join(this.directory, file), 'utf8')) as BackgroundTask
      if (task.id !== file.slice(0, -5)) throw new Error('后台任务记录损坏')
      task.logPath = join(this.directory, `${task.id}.log`)
      if (isTaskActive(task)) {
        if (existsSync(task.logPath)) {
          const output = readFileSync(task.logPath, 'utf8')
          task.output = output.slice(-outputLimit)
          task.outputTruncated = output.length > outputLimit
        }
        task.status = 'interrupted'
        task.finishedAt = Date.now()
        task.error = '上次 Runtime 已退出，任务未完成'
        this.persist(task)
      }
      this.tasks.set(task.id, task)
      this.trim()
    }
  }

  list(): BackgroundTask[] {
    return [...this.tasks.values()]
      .sort((a, b) => b.startedAt - a.startedAt)
      .map((task) => ({ ...task }))
  }

  get(id: string): BackgroundTask {
    const task =
      this.tasks.get(id) ??
      (typeof id === 'string' &&
      /^[\da-f-]{36}$/.test(id) &&
      existsSync(join(this.directory, `${id}.json`))
        ? (JSON.parse(readFileSync(join(this.directory, `${id}.json`), 'utf8')) as BackgroundTask)
        : undefined)
    if (!task) throw new Error('当前会话中不存在该后台任务')
    return { ...task }
  }

  private persist(task: BackgroundTask): void {
    const file = join(this.directory, `${task.id}.json`)
    writeFileSync(`${file}.tmp`, JSON.stringify(task), 'utf8')
    renameSync(`${file}.tmp`, file)
  }

  private publish(): void {
    if (this.publishTimer || this.closed) return
    this.publishTimer = setTimeout(() => {
      this.publishTimer = undefined
      this.changed()
    }, 250)
  }

  private trim(): void {
    const oldest = [...this.tasks.values()]
      .filter((task) => !isTaskActive(task))
      .sort((a, b) => a.startedAt - b.startedAt)
    while (this.tasks.size > taskLimit && oldest.length) this.tasks.delete(oldest.shift()!.id)
  }

  async execute(
    operations: BashOperations,
    input: {
      command: string
      cwd: string
      shell: string
      prefix?: string
      timeout?: number
      background?: boolean
      yieldTimeMs?: number
    },
    signal?: AbortSignal
  ): Promise<BackgroundTask> {
    if (this.closed) throw new Error('后台任务服务已关闭')
    if (signal?.aborted) throw new Error('命令已取消')
    if (!input.command.trim()) throw new Error('命令不能为空')
    if (this.running.size >= activeLimit)
      throw new Error('同时运行的任务已达 16 个，请先停止或等待已有任务')
    const wait = input.background ? 0 : (input.yieldTimeMs ?? 30000)
    if (!Number.isFinite(wait) || wait < 0 || wait > 30000)
      throw new Error('等待时间必须为 0 至 30000 毫秒')
    if (
      input.timeout !== undefined &&
      (!Number.isFinite(input.timeout) || input.timeout <= 0 || input.timeout > 2147483)
    )
      throw new Error('超时必须为 0 至 2147483 之间的秒数')
    mkdirSync(this.directory, { recursive: true })
    const id = randomUUID()
    const task: BackgroundTask = {
      id,
      command: input.command,
      cwd: input.cwd,
      shell: input.shell,
      status: 'running',
      startedAt: Date.now(),
      exitCode: null,
      output: '',
      outputTruncated: false,
      logPath: join(this.directory, `${id}.log`),
      logTruncated: false
    }
    const log = openSync(task.logPath, 'w')
    try {
      this.persist(task)
    } catch (error) {
      closeSync(log)
      throw error
    }
    const controller = new AbortController()
    const decoder = new StringDecoder('utf8')
    let logBytes = 0
    let logError: string | undefined
    const append = (text: string): void => {
      task.output += text
      if (task.output.length > outputLimit) {
        task.output = task.output.slice(-outputLimit)
        task.outputTruncated = true
      }
    }
    this.tasks.set(id, task)
    // 只裁剪内存中的历史列表，磁盘记录与日志仍可保留供重新打开后查询。
    this.trim()
    const cancel = (): void => {
      if (!isTaskActive(task)) return
      task.status = 'stopping'
      controller.abort()
      this.publish()
    }
    signal?.addEventListener('abort', cancel, { once: true })
    const done = Promise.resolve()
      .then(() =>
        operations.exec(
          input.prefix ? `${input.prefix}\n${input.command}` : input.command,
          input.cwd,
          {
            signal: controller.signal,
            timeout: input.timeout,
            onData: (data) => {
              append(decoder.write(data))
              const bytes = Math.min(data.length, logLimit - logBytes)
              if (bytes > 0 && !logError) {
                try {
                  let written = 0
                  while (written < bytes) {
                    const count = writeSync(log, data, written, bytes - written)
                    if (count === 0) throw new Error('无法写入日志')
                    written += count
                    logBytes += count
                  }
                } catch (error) {
                  logError = `日志保存失败：${String(error)}`
                  cancel()
                }
              }
              if (bytes < data.length) task.logTruncated = true
              this.publish()
            }
          }
        )
      )
      .then(({ exitCode }) => {
        task.exitCode = exitCode
        task.status = controller.signal.aborted
          ? 'cancelled'
          : exitCode === 0
            ? 'completed'
            : 'failed'
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        task.status = controller.signal.aborted
          ? 'cancelled'
          : message.startsWith('timeout:')
            ? 'timed_out'
            : 'failed'
        task.error = task.status === 'cancelled' ? undefined : message
      })
      .finally(() => {
        append(decoder.end())
        try {
          closeSync(log)
        } catch (error) {
          logError = `日志关闭失败：${String(error)}`
        }
        if (logError) {
          task.status = 'failed'
          task.error = logError
        }
        task.finishedAt = Date.now()
        this.running.delete(id)
        try {
          this.persist(task)
        } catch (error) {
          task.error = `任务记录保存失败：${String(error)}`
        }
        this.publish()
      })
    this.running.set(id, { controller, done })
    this.publish()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      if (wait > 0)
        await Promise.race([
          done,
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, wait)
          })
        ])
      return this.get(id)
    } finally {
      clearTimeout(timer)
      // 一旦返回句柄，停止回复只停止模型；后台进程由 stop_task 或用户单独停止。
      signal?.removeEventListener('abort', cancel)
    }
  }

  stop(id: string): BackgroundTask {
    this.get(id)
    const run = this.running.get(id)
    if (run && isTaskActive(this.tasks.get(id)!)) {
      const task = this.tasks.get(id)!
      task.status = 'stopping'
      run.controller.abort()
      this.publish()
    }
    return this.get(id)
  }

  async close(): Promise<void> {
    this.closed = true
    clearTimeout(this.publishTimer)
    const pending = [...this.running.entries()]
    for (const [id] of pending) this.stop(id)
    await Promise.all(pending.map(([, run]) => run.done))
  }
}
