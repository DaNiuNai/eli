import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AutoSaveQueue, type AutoSaveState } from '@renderer/lib/auto-save'

export function useAutoSave<T>(save: (key: string, value: T) => Promise<void>): {
  states: Record<string, AutoSaveState<T>>
  update: (key: string, value: T, delay?: number) => void
  flush: () => Promise<void>
} {
  const [states, setStates] = useState<Record<string, AutoSaveState<T>>>({})
  const active = useRef(true)
  const saveRef = useRef(save)
  const queue = useRef<AutoSaveQueue<T> | null>(null)
  useLayoutEffect(() => {
    saveRef.current = save
  }, [save])
  const getQueue = useCallback(() => {
    if (!queue.current) {
      queue.current = new AutoSaveQueue(
        (key, value) => saveRef.current(key, value),
        (key, state) => {
          if (active.current) setStates((current) => ({ ...current, [key]: state }))
        }
      )
    }
    return queue.current
  }, [])
  useEffect(() => {
    active.current = true
    const current = getQueue()
    return () => {
      active.current = false
      // 切换分类、关闭设置时提交最后一次输入，不能取消防抖后丢失修改。
      void current.flush()
    }
  }, [getQueue])
  const update = useCallback(
    (key: string, value: T, delay?: number) => {
      getQueue().update(key, value, delay)
    },
    [getQueue]
  )
  const flush = useCallback(() => getQueue().flush(), [getQueue])
  return { states, update, flush }
}
