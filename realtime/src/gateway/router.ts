export function resolveRooms(type: string, payload: Record<string, unknown>): string[] {
  const rooms = [type.split('.')[0]]

  if (payload.workCenterId) rooms.push(`wc:${payload.workCenterId}`)
  if (payload.previousWorkCenterId) rooms.push(`wc:${payload.previousWorkCenterId}`)
  if (payload.tagId) rooms.push(`tag:${payload.tagId}`)

  return rooms
}
