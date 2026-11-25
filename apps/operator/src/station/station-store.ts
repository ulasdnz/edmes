// Device-local and kept across sign-outs: the tablet stays at its machine whoever signs in.
const STORAGE_KEY = 'edmes.operator.station'

export type ReconcileResult = 'kept' | 'cleared' | 'auto-selected' | 'none'

export interface StationStore {
  getWorkCenterId(): string | null
  select(workCenterId: string): void
  clear(): void
  reconcile(visibleIds: readonly string[]): ReconcileResult
  subscribe(listener: () => void): () => void
}

export function stationRoom(workCenterId: string): string {
  return `wc:${workCenterId}`
}

export function createStationStore(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
): StationStore {
  const listeners = new Set<() => void>()
  let current = read()

  function read(): string | null {
    try {
      return storage.getItem(STORAGE_KEY) || null
    } catch {
      return null
    }
  }

  function write(workCenterId: string | null) {
    if (workCenterId === current) return
    current = workCenterId
    try {
      if (workCenterId === null) storage.removeItem(STORAGE_KEY)
      else storage.setItem(STORAGE_KEY, workCenterId)
    } catch {
      // the station lasts for this page when the device keeps nothing
    }
    for (const listener of listeners) listener()
  }

  return {
    getWorkCenterId: () => current,
    select: workCenterId => write(workCenterId),
    clear: () => write(null),
    reconcile(visibleIds) {
      if (current !== null) {
        if (visibleIds.includes(current)) return 'kept'
        write(null)
        return 'cleared'
      }
      const [only] = visibleIds
      if (visibleIds.length === 1 && only !== undefined) {
        write(only)
        return 'auto-selected'
      }
      return 'none'
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
