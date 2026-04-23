import type { Request, Response } from 'express'
import { Router } from 'express'
import WorkCenter from '../work-center/work-center.model.js'

const router = Router()

interface RunModeMonitorDocument {
  _id: { toString(): string }
  tagBindings?: { runModeTagId?: { toString(): string } | null } | null
}

router.get('/work-centers/run-mode-monitors', async (_req: Request, res: Response) => {
  const docs = await WorkCenter.find({
    type: 'physical',
    status: 'active',
    'tagBindings.runModeTagId': { $exists: true, $ne: null },
  })
    .select({ _id: 1, 'tagBindings.runModeTagId': 1 })
    .lean<RunModeMonitorDocument[]>()

  const data = docs.map(d => ({
    workCenterId: d._id.toString(),
    runModeTagId: d.tagBindings?.runModeTagId?.toString(),
  }))

  res.json({ data })
})

export default router
