import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { getPackageDir } from '@earendil-works/pi-coding-agent'

// SDK 1.3.0 的这些实现有类型声明，但未从包根导出。仅在此集中适配，升级时由测试验证。
// 不调用 CLI，不使用其默认发现逻辑。
// 保留 SDK 模块的精确推导类型，避免手写适配签名与固定版本的声明不一致。
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export async function sdkModules() {
  const moduleUrl = (path: string): string =>
    pathToFileURL(join(getPackageDir(), 'dist', path)).href
  const [
    settings,
    extensions,
    prompts,
    mcp,
    oauth,
    auth,
    composer,
    modelConfig,
    modelStore,
    mcpServers
  ] = await Promise.all([
    import(moduleUrl('core/settings-manager.js')) as Promise<
      typeof import('../../node_modules/@earendil-works/pi-coding-agent/dist/core/settings-manager.js')
    >,
    import(moduleUrl('core/extensions/loader.js')) as Promise<
      typeof import('../../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js')
    >,
    import(moduleUrl('core/prompt-templates.js')) as Promise<
      typeof import('../../node_modules/@earendil-works/pi-coding-agent/dist/core/prompt-templates.js')
    >,
    import(moduleUrl('extensions/mcp/config.js')) as Promise<
      typeof import('../../node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/config.js')
    >,
    import(moduleUrl('extensions/mcp/oauth.js')) as Promise<
      typeof import('../../node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/oauth.js')
    >,
    import(moduleUrl('core/auth-storage.js')) as Promise<
      typeof import('../../node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.js')
    >,
    import(moduleUrl('core/provider-composer.js')) as Promise<
      typeof import('../../node_modules/@earendil-works/pi-coding-agent/dist/core/provider-composer.js')
    >,
    import(moduleUrl('core/model-config.js')) as Promise<
      typeof import('../../node_modules/@earendil-works/pi-coding-agent/dist/core/model-config.js')
    >,
    import(moduleUrl('core/models-store.js')) as Promise<
      typeof import('../../node_modules/@earendil-works/pi-coding-agent/dist/core/models-store.js')
    >,
    import(moduleUrl('core/mcp-servers.js')) as Promise<
      typeof import('../../node_modules/@earendil-works/pi-coding-agent/dist/core/mcp-servers.js')
    >
  ])
  return {
    ...settings,
    ...extensions,
    ...prompts,
    ...mcp,
    ...oauth,
    ...auth,
    ...composer,
    ...modelConfig,
    ...modelStore,
    ...mcpServers
  }
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export async function sdkMcpRuntime() {
  return import(
    pathToFileURL(join(getPackageDir(), 'dist/extensions/mcp/runtime.js')).href
  ) as Promise<
    typeof import('../../node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/runtime.js')
  >
}
