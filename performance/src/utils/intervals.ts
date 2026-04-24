export type Interval = { start: Date; end: Date }

export function durationMs(iv: { start: Date; end: Date }): number {
  return iv.end.getTime() - iv.start.getTime()
}

export function clip(
  iv: { start: Date; end: Date },
  window: { start: Date; end: Date },
): Interval | null {
  const startMs = Math.max(iv.start.getTime(), window.start.getTime())
  const endMs = Math.min(iv.end.getTime(), window.end.getTime())
  if (startMs >= endMs) return null
  return { start: new Date(startMs), end: new Date(endMs) }
}

export function mergeIntervals<T extends { start: Date; end: Date }>(intervals: T[]): Interval[] {
  if (intervals.length === 0) return []
  const sorted = [...intervals].sort((a, b) => a.start.getTime() - b.start.getTime())
  const result: Interval[] = []
  let curStart = sorted[0].start.getTime()
  let curEnd = sorted[0].end.getTime()
  for (let i = 1; i < sorted.length; i++) {
    const nextStart = sorted[i].start.getTime()
    const nextEnd = sorted[i].end.getTime()
    if (nextStart <= curEnd) {
      if (nextEnd > curEnd) curEnd = nextEnd
    } else {
      result.push({ start: new Date(curStart), end: new Date(curEnd) })
      curStart = nextStart
      curEnd = nextEnd
    }
  }
  result.push({ start: new Date(curStart), end: new Date(curEnd) })
  return result
}

export function subtractIntervals(
  windows: Array<{ start: Date; end: Date }>,
  mergedStops: Array<{ start: Date; end: Date }>,
): Interval[] {
  const result: Interval[] = []
  const sortedWindows = [...windows].sort((a, b) => a.start.getTime() - b.start.getTime())
  let si = 0
  for (const w of sortedWindows) {
    let cursor = w.start.getTime()
    const endMs = w.end.getTime()
    while (si < mergedStops.length && mergedStops[si].end.getTime() <= cursor) si++
    let localI = si
    while (localI < mergedStops.length && mergedStops[localI].start.getTime() < endMs) {
      const sStart = Math.max(mergedStops[localI].start.getTime(), cursor)
      const sEnd = Math.min(mergedStops[localI].end.getTime(), endMs)
      if (cursor < sStart) {
        result.push({ start: new Date(cursor), end: new Date(sStart) })
      }
      if (sEnd > cursor) cursor = sEnd
      localI++
    }
    if (cursor < endMs) {
      result.push({ start: new Date(cursor), end: new Date(endMs) })
    }
  }
  return result
}

export function subtractOne(
  interval: { start: Date; end: Date },
  mergedStops: Array<{ start: Date; end: Date }>,
): Interval[] {
  return subtractIntervals([interval], mergedStops)
}

export function sweepIntersectDuration(
  stops: Array<{ start: Date; end: Date }>,
  windows: Array<{ start: Date; end: Date }>,
): number[] {
  const sortedWindows = [...windows].sort((a, b) => a.start.getTime() - b.start.getTime())
  return stops.map(s => {
    const sStart = s.start.getTime()
    const sEnd = s.end.getTime()
    let total = 0
    for (const w of sortedWindows) {
      const wStart = w.start.getTime()
      const wEnd = w.end.getTime()
      if (wStart >= sEnd) break
      if (wEnd <= sStart) continue
      total += Math.min(sEnd, wEnd) - Math.max(sStart, wStart)
    }
    return total
  })
}
