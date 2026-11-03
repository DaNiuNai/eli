import { spawn, execFile } from 'node:child_process'
import type { TerminalPreference } from '../shared/terminal'

export interface ShellOperations {
  exec(
    command: string,
    cwd: string,
    options: {
      signal?: AbortSignal
      timeout?: number
      onData(data: Buffer): void
    }
  ): Promise<{ exitCode: number | null }>
}

export function shellOperations(terminal: TerminalPreference): ShellOperations {
  return {
    exec(command, cwd, options) {
      options.signal?.throwIfAborted()
      const powershell = terminal.kind === 'powershell'
      const script = powershell
        ? `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $OutputEncoding=[Console]::OutputEncoding;\n${command}`
        : command
      const args = powershell
        ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script]
        : ['-c', script]
      return new Promise((resolve, reject) => {
        const env = { ...process.env }
        delete env.ELECTRON_RUN_AS_NODE
        const child = spawn(terminal.path, args, {
          cwd,
          env,
          windowsHide: true,
          detached: process.platform !== 'win32',
          stdio: ['ignore', 'pipe', 'pipe']
        })
        let timedOut = false
        let failure: Error | undefined
        let killing: Promise<void> | undefined
        const stop = (): void => {
          if (!child.pid || killing || child.exitCode !== null) return
          const pid = child.pid
          killing =
            process.platform === 'win32'
              ? new Promise<void>((done) =>
                  execFile(
                    'taskkill.exe',
                    ['/PID', String(pid), '/T', '/F'],
                    { windowsHide: true },
                    (error) => {
                      if (error && child.exitCode === null) {
                        failure = error
                        child.kill()
                      }
                      done()
                    }
                  )
                )
              : Promise.resolve().then(() => {
                  try {
                    process.kill(-pid, 'SIGKILL')
                  } catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') failure = error as Error
                  }
                })
        }
        const timer =
          options.timeout === undefined
            ? undefined
            : setTimeout(() => {
                timedOut = true
                stop()
              }, options.timeout * 1000)
        options.signal?.addEventListener('abort', stop, { once: true })
        child.stdout.on('data', options.onData)
        child.stderr.on('data', options.onData)
        child.once('error', (error) => {
          failure = error
        })
        child.once('close', (exitCode) => {
          clearTimeout(timer)
          options.signal?.removeEventListener('abort', stop)
          void Promise.resolve(killing).then(() => {
            if (timedOut) reject(new Error(`timeout: 命令超过 ${options.timeout} 秒`))
            else if (failure) reject(failure)
            else resolve({ exitCode })
          })
        })
        if (options.signal?.aborted) stop()
      })
    }
  }
}
