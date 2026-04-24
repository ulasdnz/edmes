import { describe, expect, it } from 'vitest'
import {
  clip,
  mergeIntervals,
  subtractIntervals,
  subtractOne,
  sweepIntersectDuration,
} from './intervals.js'

const t = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 0, minutes, 0))

function mulberry32(seed: number) {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let x = Math.imul(s ^ (s >>> 15), 1 | s)
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

describe('intervals.clip', () => {
  it('keeps interval fully inside the window', () => {
    const r = clip({ start: t(10), end: t(20) }, { start: t(0), end: t(30) })
    expect(r).toEqual({ start: t(10), end: t(20) })
  })
  it('returns null when fully outside', () => {
    const before = clip({ start: t(0), end: t(5) }, { start: t(10), end: t(20) })
    const after = clip({ start: t(30), end: t(40) }, { start: t(10), end: t(20) })
    expect(before).toBeNull()
    expect(after).toBeNull()
  })
  it('clips to the window boundaries', () => {
    const r = clip({ start: t(5), end: t(25) }, { start: t(10), end: t(20) })
    expect(r).toEqual({ start: t(10), end: t(20) })
  })
  it('returns null for zero-length or touching intervals', () => {
    const zero = clip({ start: t(10), end: t(10) }, { start: t(0), end: t(20) })
    const touch = clip({ start: t(20), end: t(30) }, { start: t(10), end: t(20) })
    expect(zero).toBeNull()
    expect(touch).toBeNull()
  })
})

describe('intervals.mergeIntervals', () => {
  it('merges overlapping intervals', () => {
    const r = mergeIntervals([
      { start: t(0), end: t(10) },
      { start: t(5), end: t(15) },
    ])
    expect(r).toEqual([{ start: t(0), end: t(15) }])
  })
  it('merges adjacent intervals (touching)', () => {
    const r = mergeIntervals([
      { start: t(0), end: t(10) },
      { start: t(10), end: t(20) },
    ])
    expect(r).toEqual([{ start: t(0), end: t(20) }])
  })
  it('keeps disjoint intervals separate and sorted', () => {
    const r = mergeIntervals([
      { start: t(20), end: t(30) },
      { start: t(0), end: t(5) },
    ])
    expect(r).toEqual([
      { start: t(0), end: t(5) },
      { start: t(20), end: t(30) },
    ])
  })
  it('returns [] on empty input', () => {
    expect(mergeIntervals([])).toEqual([])
  })
})

describe('intervals.subtractIntervals', () => {
  it('returns the window when no stops overlap', () => {
    const r = subtractIntervals([{ start: t(0), end: t(100) }], [{ start: t(200), end: t(300) }])
    expect(r).toEqual([{ start: t(0), end: t(100) }])
  })
  it('splits a window around an internal stop', () => {
    const r = subtractIntervals([{ start: t(0), end: t(100) }], [{ start: t(30), end: t(40) }])
    expect(r).toEqual([
      { start: t(0), end: t(30) },
      { start: t(40), end: t(100) },
    ])
  })
  it('clips a stop that crosses a window boundary', () => {
    const r = subtractOne({ start: t(10), end: t(90) }, [{ start: t(0), end: t(50) }])
    expect(r).toEqual([{ start: t(50), end: t(90) }])
  })
  it('handles multiple windows and multiple stops', () => {
    const r = subtractIntervals(
      [
        { start: t(0), end: t(50) },
        { start: t(60), end: t(120) },
      ],
      [
        { start: t(20), end: t(30) },
        { start: t(70), end: t(80) },
        { start: t(110), end: t(130) },
      ],
    )
    expect(r).toEqual([
      { start: t(0), end: t(20) },
      { start: t(30), end: t(50) },
      { start: t(60), end: t(70) },
      { start: t(80), end: t(110) },
    ])
  })
  it('fuzz — result pieces never overlap merged stops (1k random intervals)', () => {
    const rng = mulberry32(0xdeadbeef)
    const stops: { start: Date; end: Date }[] = []
    for (let i = 0; i < 1000; i++) {
      const s = Math.floor(rng() * 10_000)
      const len = 1 + Math.floor(rng() * 50)
      stops.push({ start: new Date(s * 1000), end: new Date((s + len) * 1000) })
    }
    const merged = mergeIntervals(stops)
    const windows = [{ start: new Date(0), end: new Date(11_000_000) }]
    const pieces = subtractIntervals(windows, merged)

    for (let i = 1; i < merged.length; i++) {
      expect(merged[i].start.getTime()).toBeGreaterThan(merged[i - 1].end.getTime())
    }
    for (const piece of pieces) {
      for (const stop of merged) {
        const overlap =
          Math.min(piece.end.getTime(), stop.end.getTime()) -
          Math.max(piece.start.getTime(), stop.start.getTime())
        expect(overlap).toBeLessThanOrEqual(0)
      }
    }
  })
})

describe('intervals.sweepIntersectDuration', () => {
  it('sums overlap time across multiple windows', () => {
    const r = sweepIntersectDuration(
      [{ start: t(0), end: t(100) }],
      [
        { start: t(10), end: t(20) },
        { start: t(40), end: t(50) },
      ],
    )
    expect(r[0]).toBe(20 * 60_000)
  })
  it('returns 0 when no overlap', () => {
    const r = sweepIntersectDuration([{ start: t(0), end: t(10) }], [{ start: t(20), end: t(30) }])
    expect(r[0]).toBe(0)
  })
})
