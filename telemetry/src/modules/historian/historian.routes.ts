import { requirePermission } from '@mes/auth'
import { Router } from 'express'
import { validateParams, validateQuery } from '../../core/middleware/validate.js'
import * as historianController from './historian.controller.js'
import {
  rangeQuerySchema,
  rollupQuerySchema,
  samplesQuerySchema,
  seriesQuerySchema,
  tagIdParamSchema,
} from './historian.validators.js'

const router = Router()

router.get(
  '/historian/:tagId/compact-values',
  requirePermission('readHistorian'),
  validateParams(tagIdParamSchema),
  validateQuery(rangeQuerySchema),
  historianController.getCompactValues,
)

router.get(
  '/historian/:tagId/series',
  requirePermission('readHistorian'),
  validateParams(tagIdParamSchema),
  validateQuery(seriesQuerySchema),
  historianController.getSeries,
)

router.get(
  '/historian/:tagId/samples',
  requirePermission('readHistorian'),
  validateParams(tagIdParamSchema),
  validateQuery(samplesQuerySchema),
  historianController.getSamples,
)

router.get(
  '/historian/:tagId/count',
  requirePermission('readHistorian'),
  validateParams(tagIdParamSchema),
  validateQuery(rangeQuerySchema),
  historianController.getSampleCount,
)

router.get(
  '/historian/:tagId/stats',
  requirePermission('readHistorian'),
  validateParams(tagIdParamSchema),
  validateQuery(rangeQuerySchema),
  historianController.getStats,
)

router.get(
  '/historian/:tagId/produced',
  requirePermission('readHistorian'),
  validateParams(tagIdParamSchema),
  validateQuery(rangeQuerySchema),
  historianController.getProduced,
)

router.get(
  '/historian/:tagId/speed-avg',
  requirePermission('readHistorian'),
  validateParams(tagIdParamSchema),
  validateQuery(rangeQuerySchema),
  historianController.getSpeedAvg,
)

router.get(
  '/historian/:tagId/state-durations',
  requirePermission('readHistorian'),
  validateParams(tagIdParamSchema),
  validateQuery(rangeQuerySchema),
  historianController.getStateDurations,
)

router.get(
  '/historian/:tagId/latest',
  requirePermission('readHistorian'),
  validateParams(tagIdParamSchema),
  historianController.getLatest,
)

router.get(
  '/historian/:tagId/rollup',
  requirePermission('readHistorian'),
  validateParams(tagIdParamSchema),
  validateQuery(rollupQuerySchema),
  historianController.getRollup,
)

export default router
