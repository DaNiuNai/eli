export type BackgroundTaskStatus =
  'running' | 'stopping' | 'completed' | 'failed' | 'cancelled' | 'timed_out' | 'interrupted'

export interface BackgroundTask {
  id: string
  command: string
  cwd: string
  shell: string
  status: BackgroundTaskStatus
  startedAt: number
  finishedAt?: number
  exitCode: number | null
  output: string
  outputTruncated: boolean
  logPath: string
  logTruncated: boolean
  error?: string
}

export function isTaskActive(task: Pick<BackgroundTask, 'status'>): boolean {
  return task.status === 'running' || task.status === 'stopping'
}
