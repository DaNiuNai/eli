import { useRef, useState } from 'react'
import { imageExtension } from '../../../shared/chat-images'
import { maxChatFileBytes, type ChatDraftAttachment } from '../../../shared/chat-attachments'
import { useLanguage } from './use-language'

type Perform = (action: () => Promise<unknown>, sessionKey?: string) => Promise<boolean>

export function useChatAttachments(
  sessionKey: string,
  perform: Perform
): {
  attachments: ChatDraftAttachment[]
  adding: boolean
  choose: () => Promise<void>
  addFiles: (files: File[], forceCopy?: boolean) => void
  remove: (ids: string[]) => void
  discard: (key: string) => void
} {
  const { language } = useLanguage()
  const [drafts, setDrafts] = useState<Record<string, ChatDraftAttachment[]>>({})
  const [pending, setPending] = useState<Record<string, number>>({})
  const queues = useRef(new Map<string, Promise<void>>())

  // 同一会话的选择、拖拽、粘贴按事件顺序处理，慢附件不会被后来附件插队。
  function enqueue(action: () => Promise<void>): Promise<void> {
    setPending((current) => ({ ...current, [sessionKey]: (current[sessionKey] ?? 0) + 1 }))
    const previous = queues.current.get(sessionKey) ?? Promise.resolve()
    const next = previous.then(async () => {
      await perform(action, sessionKey)
      setPending((current) => ({ ...current, [sessionKey]: (current[sessionKey] ?? 1) - 1 }))
      if (queues.current.get(sessionKey) === next) queues.current.delete(sessionKey)
    })
    queues.current.set(sessionKey, next)
    return next
  }

  function append(paths: string[]): void {
    if (paths.some((path) => !path)) throw new Error('请选择本机文件')
    const attachments = paths.map((path) => ({ id: crypto.randomUUID(), path }))
    setDrafts((current) => ({
      ...current,
      [sessionKey]: [...(current[sessionKey] ?? []), ...attachments]
    }))
  }

  function choose(): Promise<void> {
    return enqueue(async () => append(await window.api.chooseFiles(language)))
  }

  function addFiles(files: File[], forceCopy = false): void {
    void enqueue(async () => {
      const paths: string[] = []
      for (const file of files) {
        let path = ''
        if (!forceCopy) {
          try {
            path = window.api.getFilePath(file)
          } catch {
            // 某些拖拽来源只提供文件内容，没有可用的本地文件路径。
          }
        }
        if (!path) {
          if (file.size > maxChatFileBytes) throw new Error('文件超过 32 MB')
          const bytes = new Uint8Array(await file.arrayBuffer())
          path =
            forceCopy || imageExtension.test(file.name)
              ? await window.api.saveImageData(bytes)
              : await window.api.saveFileData(file.name, bytes)
        }
        paths.push(path)
      }
      append(paths)
    })
  }

  function remove(ids: string[]): void {
    const removed = new Set(ids)
    setDrafts((current) => ({
      ...current,
      [sessionKey]: (current[sessionKey] ?? []).filter((attachment) => !removed.has(attachment.id))
    }))
  }

  function discard(key: string): void {
    setDrafts((current) => {
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  return {
    attachments: drafts[sessionKey] ?? [],
    adding: (pending[sessionKey] ?? 0) > 0,
    choose,
    addFiles,
    remove,
    discard
  }
}
