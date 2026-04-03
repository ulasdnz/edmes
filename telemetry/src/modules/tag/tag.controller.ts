import type { Request, Response } from 'express'
import type { SuccessResponse } from '../../core/types/index.js'
import type { ITag } from './tag.model.js'
import * as tagService from './tag.service.js'

export const createTag = async (req: Request, res: Response<SuccessResponse<ITag>>) => {
  const tag = await tagService.createTag(req.body)

  res.status(201).json({
    data: tag,
    message: req.t('success.create'),
  })
}

export const getTags = async (_req: Request, res: Response<SuccessResponse<ITag[]>>) => {
  const tags = await tagService.getTags()

  res.json({
    data: tags,
  })
}

export const getTagById = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<ITag>>,
) => {
  const tag = await tagService.getTagById(req.params.id)

  res.json({
    data: tag,
  })
}

export const updateTag = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<ITag>>,
) => {
  const tag = await tagService.updateTag(req.params.id, req.body)

  res.json({
    data: tag,
    message: req.t('success.update'),
  })
}

export const deleteTag = async (
  req: Request<{ id: string }, unknown, unknown, { forceDelete?: string }>,
  res: Response<SuccessResponse>,
) => {
  const forceDelete = req.query.forceDelete === 'true'
  await tagService.deleteTag(req.params.id, forceDelete)

  res.json({
    data: undefined,
    message: req.t('success.delete'),
  })
}
