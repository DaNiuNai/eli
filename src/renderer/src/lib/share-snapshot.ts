/** IPC 会复制整棵状态树；保留未变化分支的引用，让订阅者跳过无关更新。 */
export function shareSnapshot<T>(previous: T, incoming: T): T {
  if (Object.is(previous, incoming)) return previous
  if (!previous || !incoming || typeof previous !== 'object' || typeof incoming !== 'object')
    return incoming
  if (Array.isArray(previous) !== Array.isArray(incoming)) return incoming
  const before = previous as Record<string, unknown>
  const after = incoming as Record<string, unknown>
  const keys = Object.keys(after)
  let equal = keys.length === Object.keys(before).length
  for (const key of keys) {
    const value = shareSnapshot(before[key], after[key])
    if (!Object.hasOwn(before, key) || value !== before[key]) equal = false
    after[key] = value
  }
  if (Array.isArray(previous) && Array.isArray(incoming) && previous.length !== incoming.length)
    equal = false
  return equal ? previous : incoming
}
