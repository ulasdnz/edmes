import type { JobOrder } from '@mes/frontend/data/production/job-orders'
import { describe, expect, it } from 'vitest'
import { renderWithI18n } from '../../test/render'
import { CurrentJobOrder } from './current-job-order'

const running: JobOrder = {
  _id: '6650a1f0c2b4a1d2e3f40001',
  code: 'JO-1001',
  productId: '6650a1f0c2b4a1d2e3f40002',
  workCenterId: '6650a1f0c2b4a1d2e3f40003',
  productionPlanId: null,
  targetQuantity: 500,
  plannedStartAt: null,
  dueAt: null,
  startTime: '2026-11-25T06:00:00.000Z',
  endTime: null,
  description: null,
  props: {},
  createdBy: '6650a1f0c2b4a1d2e3f40004',
  updatedBy: null,
  startedBy: '6650a1f0c2b4a1d2e3f40004',
  endedBy: null,
  createdAt: '2026-11-25T05:00:00.000Z',
  updatedAt: '2026-11-25T06:00:00.000Z',
}

describe('CurrentJobOrder', () => {
  it('says so when nothing is running', async () => {
    const screen = await renderWithI18n(<CurrentJobOrder jobOrder={null} />)
    await expect.element(screen.getByText('No running job order')).toBeVisible()
  })

  it('shows the code and the target of the running job order', async () => {
    const screen = await renderWithI18n(<CurrentJobOrder jobOrder={running} />)
    await expect.element(screen.getByText('JO-1001')).toBeVisible()
    await expect.element(screen.getByText('500', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('No running job order')).not.toBeInTheDocument()
  })
})
