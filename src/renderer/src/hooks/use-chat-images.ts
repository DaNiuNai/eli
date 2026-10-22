import { useRef, useState } from 'react'
import { imageExtension, maxChatImageBytes, type ChatDraftImage } from '../../../shared/chat-images'
import { useLanguage } from './use-language'

type Perform = (action: () => Promise<unknown>, sessionKey?: string) => Promise<boolean>

export function useChatImages(
  sessionKey: string,
  perform: Perform
): {
  images: ChatDraftImage[]
  adding: boolean
  choose: () => Promise<void>
  addFiles: (files: File[], forceCopy?: boolean) => void
  remove: (ids: string[]) => void
  discard: (key: string) => void
} {
  const { language } = useLanguage()
  const [drafts, setDrafts] = useState<Record<string, ChatDraftImage[]>>({})
  const [pending, setPending] = useState<Record<string, number>>({})
  const queues = useRef(new Map<string, Promise<void>>())

  // 同一会话的选择、拖拽、粘贴按事件顺序处理，慢图片不会被后来图片插队。
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
    if (paths.some((path) => !path || !imageExtension.test(path)))
      throw new Error('请选择本机图片文件')
    const images = paths.map((path) => ({ id: crypto.randomUUID(), path }))
    setDrafts((current) => ({
      ...current,
      [sessionKey]: [...(current[sessionKey] ?? []), ...images]
    }))
  }

  function choose(): Promise<void> {
    return enqueue(async () => append(await window.api.chooseImages(language)))
  }

  function addFiles(files: File[], forceCopy = false): void {
    void enqueue(async () => {
      const paths: string[] = []
      for (const file of files) {
        let path = ''
        if (!forceCopy) {
          try {
            path = window.api.getImagePath(file)
          } catch {
            // 某些拖拽来源只提供图片内容，没有可用的本地文件路径。
          }
        }
        if (!path) {
          if (!file.size || file.size > maxChatImageBytes) throw new Error('图片为空或超过 32 MB')
          path = await window.api.saveImageData(new Uint8Array(await file.arrayBuffer()))
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
      [sessionKey]: (current[sessionKey] ?? []).filter((image) => !removed.has(image.id))
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
    images: drafts[sessionKey] ?? [],
    adding: (pending[sessionKey] ?? 0) > 0,
    choose,
    addFiles,
    remove,
    discard
  }
}
