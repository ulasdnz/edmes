import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomError } from '../../core/errors/index.js'
import { writeValue } from './tag-value.controller.js'

const { findByIdMock, ingestValueMock, predecessorLoadMock } = vi.hoisted(() => ({
  findByIdMock: vi.fn(),
  ingestValueMock: vi.fn(),
  predecessorLoadMock: vi.fn(),
}))

vi.mock('./tag.model.js', () => ({
  default: {
    findById: findByIdMock,
  },
}))

vi.mock('../ingestion/ingestion.pipeline.js', () => ({
  ingestValue: ingestValueMock,
}))

vi.mock('../ingestion/predecessor-cache.js', () => ({
  predecessorLoad: predecessorLoadMock,
}))

describe('tag-value.controller.writeValue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    predecessorLoadMock.mockResolvedValue(undefined)
  })

  it('returns 201 when a new value is inserted', async () => {
    findByIdMock.mockResolvedValue({ _id: 'tag-1', behavior: 'speed', digit: 1 })
    ingestValueMock.mockResolvedValue({ applied: true, reason: 'history_inserted' })

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    }

    await writeValue(
      {
        params: { id: 'tag-1' },
        body: { time: new Date('2026-04-04T16:30:00.000Z'), value: 421 },
        t: vi.fn().mockReturnValue('Created successfully'),
      } as never,
      res as never,
    )

    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json).toHaveBeenCalledWith({
      data: { inserted: true, reason: 'history_inserted' },
      message: 'Created successfully',
    })
  })

  it('throws 409 when ingestion reports out-of-order data', async () => {
    findByIdMock.mockResolvedValue({ _id: 'tag-1', behavior: 'speed', digit: 1 })
    ingestValueMock.mockResolvedValue({ applied: false, reason: 'out_of_order' })

    await expect(
      writeValue(
        {
          params: { id: 'tag-1' },
          body: { time: new Date('2026-04-04T16:31:00.000Z'), value: 420 },
          t: vi.fn(),
        } as never,
        {} as never,
      ),
    ).rejects.toEqual(new CustomError(409, 'tag.out_of_order'))
  })

  it('throws 409 when ingestion reports a value within tolerance', async () => {
    findByIdMock.mockResolvedValue({ _id: 'tag-1', behavior: 'speed', digit: 1 })
    ingestValueMock.mockResolvedValue({ applied: false, reason: 'within_tolerance' })

    await expect(
      writeValue(
        {
          params: { id: 'tag-1' },
          body: { time: new Date('2026-04-04T16:31:00.000Z'), value: 420.2 },
          t: vi.fn(),
        } as never,
        {} as never,
      ),
    ).rejects.toEqual(new CustomError(409, 'tag.within_tolerance'))
  })

  it('throws 409 when the incoming value matches the latest value', async () => {
    findByIdMock.mockResolvedValue({ _id: 'tag-1', behavior: 'speed', digit: 1 })
    predecessorLoadMock.mockResolvedValue({
      value: 421,
      occurredAt: new Date('2026-04-04T16:29:00.000Z'),
      prevValue: 420,
      prevTs: new Date('2026-04-04T16:28:00.000Z'),
    })

    await expect(
      writeValue(
        {
          params: { id: 'tag-1' },
          body: { time: new Date('2026-04-04T16:31:00.000Z'), value: 421 },
          t: vi.fn(),
        } as never,
        {} as never,
      ),
    ).rejects.toEqual(new CustomError(409, 'tag.same_value'))

    expect(ingestValueMock).not.toHaveBeenCalled()
  })
})
