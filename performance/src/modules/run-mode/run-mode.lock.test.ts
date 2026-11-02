import { describe, expect, it } from 'vitest'
import { withTagLock } from './run-mode.lock.js'

// A promise the test resolves when it chooses
function gate() {
  let open = (): void => {}
  const opened = new Promise<void>(resolve => {
    open = resolve
  })
  return { opened, open }
}

// Lets every promise that can settle now do so
const settle = () => new Promise(resolve => setImmediate(resolve))

const tag = (runModeTagId: string) => ({ workCenterId: 'wc-1', runModeTagId })

describe('withTagLock', () => {
  it('runs one caller of a tag at a time, in the order they came', async () => {
    const events: string[] = []
    const gates = [gate(), gate(), gate()]
    const calls = gates.map((g, i) =>
      withTagLock(tag('tag-1'), async () => {
        events.push(`start ${i}`)
        await g.opened
        events.push(`end ${i}`)
        return i
      }),
    )

    await settle()
    expect(events).toEqual(['start 0'])

    // The later callers are ready first, and still wait their turn
    gates[2].open()
    gates[1].open()
    await settle()
    expect(events).toEqual(['start 0'])

    gates[0].open()
    expect(await Promise.all(calls)).toEqual([0, 1, 2])
    expect(events).toEqual(['start 0', 'end 0', 'start 1', 'end 1', 'start 2', 'end 2'])
  })

  it('lets a caller of another tag run meanwhile', async () => {
    const events: string[] = []
    const first = gate()
    const holding = withTagLock(tag('tag-1'), async () => {
      events.push('tag-1 start')
      await first.opened
      events.push('tag-1 end')
    })

    await withTagLock(tag('tag-2'), async () => {
      events.push('tag-2')
    })

    expect(events).toEqual(['tag-1 start', 'tag-2'])
    first.open()
    await holding
    expect(events).toEqual(['tag-1 start', 'tag-2', 'tag-1 end'])
  })

  it('passes a failure to its caller and lets the next caller of the tag run', async () => {
    const failing = withTagLock(tag('tag-1'), async () => {
      throw new Error('MongoDB failed')
    })
    const next = withTagLock(tag('tag-1'), async () => 'decided')

    await expect(failing).rejects.toThrow('MongoDB failed')
    expect(await next).toBe('decided')
  })
})
