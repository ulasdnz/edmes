export function resolveRooms(type: string, payload: Record<string, unknown>): string[] {
  const rooms = new Set<string>([type.split('.')[0]])

  if (payload.workCenterId) rooms.add(`wc:${payload.workCenterId}`)
  if (payload.previousWorkCenterId) rooms.add(`wc:${payload.previousWorkCenterId}`)
  if (Array.isArray(payload.workCenterIds)) {
    for (const id of payload.workCenterIds) {
      if (typeof id === 'string' && id) rooms.add(`wc:${id}`)
    }
  }
  if (payload.tagId) rooms.add(`tag:${payload.tagId}`)

  return [...rooms]
}
