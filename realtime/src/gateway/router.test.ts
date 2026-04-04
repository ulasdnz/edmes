import { describe, expect, it } from 'vitest'
import { resolveRooms } from './router.js'

describe('resolveRooms', () => {
  // ── happy path ────────────────────────────────────────────────────────

  it("returns ['job_order', 'wc:abc'] for type='job_order.started' with workCenterId", () => {
    const rooms = resolveRooms('job_order.started', { workCenterId: 'abc' })
    expect(rooms).toEqual(['job_order', 'wc:abc'])
  })

  it("returns ['role'] for type='role.updated' with empty payload", () => {
    const rooms = resolveRooms('role.updated', {})
    expect(rooms).toEqual(['role'])
  })

  it("returns ['production_plan'] for type='production_plan.created' with empty payload", () => {
    const rooms = resolveRooms('production_plan.created', {})
    expect(rooms).toEqual(['production_plan'])
  })

  it("returns ['scrap_entry', 'wc:xyz'] and does NOT add jobOrderId as room", () => {
    const rooms = resolveRooms('scrap_entry.created', {
      workCenterId: 'xyz',
      jobOrderId: '123',
    })
    expect(rooms).toEqual(['scrap_entry', 'wc:xyz'])
  })

  // ── constraints ───────────────────────────────────────────────────────

  it('derives entity prefix room from type.split(".")[0] as first element', () => {
    const rooms = resolveRooms('quantity_adjustment.updated', { workCenterId: 'w1' })
    expect(rooms[0]).toBe('quantity_adjustment')
  })

  it('adds wc:{id} room when workCenterId is in payload', () => {
    const rooms = resolveRooms('job_order.created', { workCenterId: 'w1' })
    expect(rooms).toContain('wc:w1')
  })

  it('adds wc:{previousId} room when previousWorkCenterId is in payload', () => {
    const rooms = resolveRooms('job_order.updated', {
      workCenterId: 'new1',
      previousWorkCenterId: 'old1',
    })
    expect(rooms).toContain('wc:old1')
  })

  it('does NOT add a room for jobOrderId in payload', () => {
    const rooms = resolveRooms('scrap_entry.created', {
      workCenterId: 'w1',
      jobOrderId: 'jo1',
    })
    expect(rooms).not.toContain('jo1')
    expect(rooms).not.toContain('jo:jo1')
  })

  it('adds tag:{id} room when tagId is in payload', () => {
    const rooms = resolveRooms('tag.value.updated', { tagId: 'tag-1' })
    expect(rooms).toEqual(['tag', 'tag:tag-1'])
  })

  // ── boundaries ────────────────────────────────────────────────────────

  it("uses entire string as prefix for type with no dot (e.g. 'heartbeat')", () => {
    const rooms = resolveRooms('heartbeat', {})
    expect(rooms).toEqual(['heartbeat'])
  })

  it('uses only first segment for type with multiple dots', () => {
    const rooms = resolveRooms('work_center.operator.checked_in', {})
    expect(rooms[0]).toBe('work_center')
    expect(rooms).toEqual(['work_center'])
  })

  // ── edge cases ────────────────────────────────────────────────────────

  it('returns three rooms when both workCenterId and previousWorkCenterId differ', () => {
    const rooms = resolveRooms('job_order.updated', {
      workCenterId: 'abc',
      previousWorkCenterId: 'def',
    })
    expect(rooms).toEqual(['job_order', 'wc:abc', 'wc:def'])
  })

  it('returns duplicate wc rooms when workCenterId equals previousWorkCenterId', () => {
    const rooms = resolveRooms('job_order.updated', {
      workCenterId: 'abc',
      previousWorkCenterId: 'abc',
    })
    expect(rooms).toEqual(['job_order', 'wc:abc', 'wc:abc'])
  })

  it('returns only entity prefix room for empty payload', () => {
    const rooms = resolveRooms('role.deleted', {})
    expect(rooms).toEqual(['role'])
  })

  it('does NOT add routing room when workCenterId is falsy', () => {
    for (const falsy of [null, undefined, '']) {
      const rooms = resolveRooms('job_order.updated', { workCenterId: falsy })
      expect(rooms).toEqual(['job_order'])
    }
  })

  it('does NOT add routing room when previousWorkCenterId is falsy', () => {
    for (const falsy of [null, undefined, '']) {
      const rooms = resolveRooms('job_order.updated', {
        workCenterId: 'abc',
        previousWorkCenterId: falsy,
      })
      expect(rooms).toEqual(['job_order', 'wc:abc'])
    }
  })
})
