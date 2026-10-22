import { Agent, ProxyAgent, install, setGlobalDispatcher, type Dispatcher } from 'undici'
import type { SettingsManager } from '@earendil-works/pi-coding-agent'

let dispatcher: Dispatcher | undefined

/** 网络配置属于当前 Runtime，不读取或改写进程环境变量。 */
export async function configureNetwork(settings: SettingsManager): Promise<void> {
  const timeout = settings.getHttpIdleTimeoutMs()
  const proxy = settings.getSettings().httpProxy?.trim()
  const options = {
    headersTimeout: timeout,
    bodyTimeout: timeout,
    connect: { autoSelectFamilyAttemptTimeout: 2000 }
  }
  const next = proxy ? new ProxyAgent({ ...options, uri: proxy }) : new Agent(options)
  setGlobalDispatcher(next)
  install()
  const previous = dispatcher
  dispatcher = next
  await previous?.close()
}

export async function closeNetwork(): Promise<void> {
  await dispatcher?.destroy()
  dispatcher = undefined
}
