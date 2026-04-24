export function isNonOverlapping(windows: Array<{ from: Date; to: Date }>): boolean {
  if (windows.length <= 1) return true
  const sorted = [...windows].sort((a, b) => a.from.getTime() - b.from.getTime())
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].from.getTime() < sorted[i - 1].to.getTime()) return false
  }
  return true
}
