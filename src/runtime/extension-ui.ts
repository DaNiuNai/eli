import type { ExtensionUIContext } from '@earendil-works/pi-coding-agent'

/** 保留桌面通知；需要终端组件的扩展明确失败，避免静默返回虚构的用户答复。 */
export function desktopExtensionUi(
  base: ExtensionUIContext,
  notify: (message: string) => void
): ExtensionUIContext {
  const unsupported = async (): Promise<never> => {
    throw new Error('此扩展需要终端交互界面；请使用 eli 的 ask_user_question 工具获取用户决定。')
  }
  return Object.assign(Object.create(base) as ExtensionUIContext, {
    notify,
    select: unsupported,
    confirm: unsupported,
    input: unsupported,
    editor: unsupported,
    custom: unsupported
  })
}
