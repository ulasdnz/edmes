export function workCenterIdsOf(payload: Record<string, unknown>): string[] {
  const ids = new Set<string>()

  if (payload.workCenterId) ids.add(String(payload.workCenterId))
  if (payload.previousWorkCenterId) ids.add(String(payload.previousWorkCenterId))
  if (Array.isArray(payload.workCenterIds)) {
    for (const id of payload.workCenterIds) {
      if (typeof id === 'string' && id) ids.add(id)
    }
  }

  return [...ids]
}

export function resolveRooms(type: string, payload: Record<string, unknown>): string[] {
  const rooms = new Set<string>([type.split('.')[0]])

  for (const id of workCenterIdsOf(payload)) rooms.add(`wc:${id}`)
  if (payload.tagId) rooms.add(`tag:${payload.tagId}`)

  return [...rooms]
}
