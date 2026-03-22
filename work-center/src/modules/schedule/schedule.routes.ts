import { requirePermission } from '@mes/auth'
import { Router } from 'express'
import { validateBody, validateParams, validateQuery } from '../../core/middleware/validate.js'
import * as controller from './schedule.controller.js'
import {
  calendarIdParamSchema,
  createCalendarSchema,
  effectiveScheduleQuerySchema,
  exceptionParamSchema,
  patchCalendarSchema,
  replaceCalendarSchema,
  scheduleWorkCenterIdParamSchema,
  upsertExceptionSchema,
} from './schedule.validators.js'

const router = Router()

// ── Calendar CRUD ───────────────────────────────────────────────────────────

router.post(
  '/work-centers/:workCenterId/calendars',
  requirePermission('writeSchedules'),
  validateParams(scheduleWorkCenterIdParamSchema),
  validateBody(createCalendarSchema),
  controller.createCalendar,
)

router.get(
  '/work-centers/:workCenterId/calendars',
  requirePermission('readSchedules'),
  validateParams(scheduleWorkCenterIdParamSchema),
  controller.getCalendars,
)

router.get(
  '/work-centers/:workCenterId/calendars/:calendarId',
  requirePermission('readSchedules'),
  validateParams(calendarIdParamSchema),
  controller.getCalendar,
)

router.put(
  '/work-centers/:workCenterId/calendars/:calendarId',
  requirePermission('writeSchedules'),
  validateParams(calendarIdParamSchema),
  validateBody(replaceCalendarSchema),
  controller.replaceCalendar,
)

router.patch(
  '/work-centers/:workCenterId/calendars/:calendarId',
  requirePermission('writeSchedules'),
  validateParams(calendarIdParamSchema),
  validateBody(patchCalendarSchema),
  controller.updateCalendar,
)

router.delete(
  '/work-centers/:workCenterId/calendars/:calendarId',
  requirePermission('writeSchedules'),
  validateParams(calendarIdParamSchema),
  controller.deleteCalendar,
)

// ── Date exceptions ─────────────────────────────────────────────────────────

router.put(
  '/work-centers/:workCenterId/exceptions/:localDate',
  requirePermission('writeSchedules'),
  validateParams(exceptionParamSchema),
  validateBody(upsertExceptionSchema),
  controller.upsertException,
)

router.delete(
  '/work-centers/:workCenterId/exceptions/:localDate',
  requirePermission('writeSchedules'),
  validateParams(exceptionParamSchema),
  controller.deleteException,
)

// ── Effective schedule ──────────────────────────────────────────────────────

router.get(
  '/work-centers/:workCenterId/schedule',
  requirePermission('readSchedules'),
  validateParams(scheduleWorkCenterIdParamSchema),
  validateQuery(effectiveScheduleQuerySchema),
  controller.getEffectiveSchedule,
)

export default router
