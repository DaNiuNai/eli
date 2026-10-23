export type AutoSaveStatus = 'pending' | 'saving' | 'saved' | 'error'

export interface AutoSaveState<T> {
  value: T
  status: AutoSaveStatus
  error?: string
}

interface Job<T> {
  key: string
  value: T
  revision: number
  ready: boolean
  timer?: ReturnType<typeof setTimeout>
}

/** 合并同一字段的连续输入，串行提交不同字段，旧请求不覆盖新输入的状态。 */
export class AutoSaveQueue<T> {
  private jobs = new Map<string, Job<T>>()
  private revisions = new Map<string, number>()
  private running = false
  private idle: (() => void)[] = []

  constructor(
    private save: (key: string, value: T) => Promise<void>,
    private changed: (key: string, state: AutoSaveState<T>) => void
  ) {}

  update(key: string, value: T, delay = 400): void {
    const previous = this.jobs.get(key)
    if (previous?.timer) clearTimeout(previous.timer)
    const revision = (this.revisions.get(key) ?? 0) + 1
    this.revisions.set(key, revision)
    const job: Job<T> = { key, value, revision, ready: delay === 0 }
    this.jobs.set(key, job)
    this.changed(key, { value, status: 'pending' })
    if (delay === 0) void this.drain()
    else {
      job.timer = setTimeout(() => {
        job.ready = true
        void this.drain()
      }, delay)
    }
  }

  flush(): Promise<void> {
    for (const job of this.jobs.values()) {
      if (job.timer) clearTimeout(job.timer)
      job.ready = true
    }
    const done = new Promise<void>((resolve) => this.idle.push(resolve))
    void this.drain()
    return done
  }

  private async drain(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      while (true) {
        const job = [...this.jobs.values()].find((candidate) => candidate.ready)
        if (!job) break
        this.jobs.delete(job.key)
        this.changed(job.key, { value: job.value, status: 'saving' })
        try {
          await this.save(job.key, job.value)
          if (this.revisions.get(job.key) === job.revision) {
            this.changed(job.key, { value: job.value, status: 'saved' })
          }
        } catch (cause) {
          if (this.revisions.get(job.key) === job.revision) {
            this.changed(job.key, {
              value: job.value,
              status: 'error',
              error: cause instanceof Error ? cause.message : String(cause)
            })
          }
        }
      }
    } finally {
      this.running = false
      if (!this.jobs.size) {
        for (const resolve of this.idle.splice(0)) resolve()
      }
    }
  }
}
