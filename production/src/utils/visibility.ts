// Limits a list query to the caller's visible work centers. A work center filter the client sends
// can only narrow that set, never replace it. Without visibleIds the caller is not limited.
export function limitToVisibleWorkCenters(
  query: Record<string, unknown>,
  visibleIds?: string[],
): void {
  if (!visibleIds) return
  const and = (query.$and as Record<string, unknown>[] | undefined) ?? []
  query.$and = [...and, { workCenterId: { $in: visibleIds } }]
}
