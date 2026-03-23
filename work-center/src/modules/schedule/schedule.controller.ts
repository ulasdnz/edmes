import type { Request, Response } from 'express'
import type { SuccessResponse } from '../../core/types/api.types.js'
import type { ICalendar, IDateException } from './schedule.model.js'
import * as scheduleService from './schedule.service.js'

// ── Calendar ────────────────────────────────────────────────────────────────

export const createCalendar = async (
  req: Request<{ workCenterId: string }>,
  res: Response<SuccessResponse<ICalendar>>,
) => {
  const calendar = await scheduleService.createCalendar(
    req.params.workCenterId,
    req.body,
    req.user!.id,
  )
  res.status(201).json({ message: req.t('success.calendar_created'), data: calendar })
}

export const getCalendar = async (
  req: Request<{ workCenterId: string; calendarId: string }>,
  res: Response<SuccessResponse<ICalendar>>,
) => {
  const calendar = await scheduleService.getCalendar(req.params.workCenterId, req.params.calendarId)
  res.json({ data: calendar })
}

export const getCalendars = async (
  req: Request<{ workCenterId: string }>,
  res: Response<SuccessResponse<ICalendar[]>>,
) => {
  const calendars = await scheduleService.getCalendars(req.params.workCenterId)
  res.json({ data: calendars })
}

export const replaceCalendar = async (
  req: Request<{ workCenterId: string; calendarId: string }>,
  res: Response<SuccessResponse<ICalendar>>,
) => {
  const calendar = await scheduleService.replaceCalendar(
    req.params.workCenterId,
    req.params.calendarId,
    req.body,
    req.user!.id,
  )
  res.json({ message: req.t('success.calendar_updated'), data: calendar })
}

export const updateCalendar = async (
  req: Request<{ workCenterId: string; calendarId: string }>,
  res: Response<SuccessResponse<ICalendar>>,
) => {
  const calendar = await scheduleService.updateCalendar(
    req.params.workCenterId,
    req.params.calendarId,
    req.body,
    req.user!.id,
  )
  res.json({ message: req.t('success.calendar_updated'), data: calendar })
}

export const deleteCalendar = async (
  req: Request<{ workCenterId: string; calendarId: string }>,
  res: Response<SuccessResponse<void>>,
) => {
  await scheduleService.deleteCalendar(req.params.workCenterId, req.params.calendarId)
  res.json({ message: req.t('success.calendar_deleted'), data: undefined })
}

// ── Date exceptions ─────────────────────────────────────────────────────────

export const upsertException = async (
  req: Request<{ workCenterId: string; localDate: string }>,
  res: Response<SuccessResponse<IDateException>>,
) => {
  const exception = await scheduleService.upsertException(
    req.params.workCenterId,
    req.params.localDate,
    req.body,
    req.user!.id,
  )
  res.json({ message: req.t('success.exception_saved'), data: exception })
}

export const deleteException = async (
  req: Request<{ workCenterId: string; localDate: string }>,
  res: Response<SuccessResponse<void>>,
) => {
  await scheduleService.deleteException(req.params.workCenterId, req.params.localDate)
  res.json({ message: req.t('success.exception_deleted'), data: undefined })
}

// ── Effective schedule ──────────────────────────────────────────────────────

export const getEffectiveSchedule = async (
  req: Request<{ workCenterId: string }>,
  res: Response,
) => {
  const schedule = await scheduleService.getEffectiveSchedule(
    req.params.workCenterId,
    req.query.date as string,
  )
  res.json({ data: schedule })
}
