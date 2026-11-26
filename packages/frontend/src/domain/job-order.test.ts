import { describe, expect, it } from 'vitest'
import { jobOrderRuntimeState } from './job-order'

describe('jobOrderRuntimeState', () => {
  it('is pending without a start time', () => {
    expect(jobOrderRuntimeState({})).toBe('pending')
    expect(jobOrderRuntimeState({ startTime: null, endTime: null })).toBe('pending')
  })

  it('is running with a start time and no end time', () => {
    expect(jobOrderRuntimeState({ startTime: '2026-04-04T12:30:00.000Z' })).toBe('running')
  })

  it('is finished with both', () => {
    expect(
      jobOrderRuntimeState({
        startTime: '2026-04-04T12:30:00.000Z',
        endTime: '2026-04-04T13:00:00.000Z',
      }),
    ).toBe('finished')
  })

  // scenario: { startTime: null, endTime: null } → 'pending'
  it('is pending when both times are null', () => {
    expect(jobOrderRuntimeState({ startTime: null, endTime: null })).toBe('pending')
  })
})
