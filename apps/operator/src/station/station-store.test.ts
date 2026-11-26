import { beforeEach, describe, expect, it } from 'vitest'
import { createStationStore, type StationStore } from './station-store'

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const items = new Map<string, string>()
  return {
    getItem: key => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: key => void items.delete(key),
  }
}

describe('station store', () => {
  let storage: ReturnType<typeof memoryStorage>
  let store: StationStore

  beforeEach(() => {
    storage = memoryStorage()
    store = createStationStore(storage)
  })

  it('keeps a stored station that is still visible', () => {
    store.select('wc1')
    expect(store.reconcile(['wc1', 'wc2'])).toBe('kept')
  })

  it('clears a stored station that is no longer visible', () => {
    store.select('wc9')
    expect(store.reconcile(['wc1'])).toBe('cleared')
    expect(store.getWorkCenterId()).toBeNull()
  })

  it('selects the only visible work center', () => {
    expect(store.reconcile(['wc1'])).toBe('auto-selected')
    expect(store.getWorkCenterId()).toBe('wc1')
  })

  it('selects nothing when several or none are visible', () => {
    expect(store.reconcile(['wc1', 'wc2'])).toBe('none')
    expect(store.reconcile([])).toBe('none')
  })

  // scenario: select('wc1') → a new store over the same storage returns 'wc1' (kept under edmes.operator.station)
  it('hands the selected station to a new store over the same storage', () => {
    store.select('wc1')
    expect(storage.getItem('edmes.operator.station')).toBe('wc1')
    expect(createStationStore(storage).getWorkCenterId()).toBe('wc1')
  })

  it('survives a sign-out', () => {
    store.select('wc1')
    storage.removeItem('edmes.operator.token')
    expect(createStationStore(storage).getWorkCenterId()).toBe('wc1')
  })

  it('keeps the station under its own key', () => {
    store.select('wc1')
    expect(storage.getItem('edmes.operator.station')).toBe('wc1')
    store.clear()
    expect(storage.getItem('edmes.operator.station')).toBeNull()
  })

  it('tells its listeners when the station changes', () => {
    let calls = 0
    const stop = store.subscribe(() => {
      calls += 1
    })
    store.select('wc1')
    store.select('wc1')
    store.clear()
    stop()
    store.select('wc2')
    expect(calls).toBe(2)
  })
})
