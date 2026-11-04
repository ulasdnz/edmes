// One writer at a time for each work center and run-mode tag in this process: the rules that
// decide its samples, its cursor and the tick take turns, in the order they came. A caller that
// holds the lock must not take it again, and must not wait on telemetry under it
const tails = new Map<string, Promise<void>>()

export async function withTagLock<T>(
  target: { workCenterId: string; runModeTagId: string },
  fn: () => Promise<T>,
): Promise<T> {
  const key = `${target.workCenterId}:${target.runModeTagId}`
  const previous = tails.get(key)
  let release = (): void => {}
  const done = new Promise<void>(resolve => {
    release = resolve
  })
  const tail = previous ? previous.then(() => done) : done
  tails.set(key, tail)
  try {
    if (previous) await previous
    return await fn()
  } finally {
    release()
    // The tag's last caller leaves nothing behind
    if (tails.get(key) === tail) tails.delete(key)
  }
}
