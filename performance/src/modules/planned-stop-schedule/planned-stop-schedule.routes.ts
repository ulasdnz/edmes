import { requirePermission } from '@mes/auth'
import { Router } from 'express'
import { validateBody, validateParams, validateQuery } from '../../core/middleware/validate.js'
import * as controller from './planned-stop-schedule.controller.js'
import {
  createScheduleSchema,
  patchScheduleSchema,
  scheduleIdParamSchema,
  scheduleListSchema,
} from './planned-stop-schedule.validators.js'

const router = Router()

router.get(
  '/planned-stop-schedules',
  requirePermission('readPlannedStopSchedules'),
  validateQuery(scheduleListSchema),
  controller.list,
)

router.get(
  '/planned-stop-schedules/:id',
  requirePermission('readPlannedStopSchedules'),
  validateParams(scheduleIdParamSchema),
  controller.getById,
)

router.post(
  '/planned-stop-schedules',
  requirePermission('createPlannedStopSchedules'),
  validateBody(createScheduleSchema),
  controller.create,
)

router.patch(
  '/planned-stop-schedules/:id',
  requirePermission('writePlannedStopSchedules'),
  validateParams(scheduleIdParamSchema),
  validateBody(patchScheduleSchema),
  controller.update,
)

router.delete(
  '/planned-stop-schedules/:id',
  requirePermission('deletePlannedStopSchedules'),
  validateParams(scheduleIdParamSchema),
  controller.remove,
)

export default router
