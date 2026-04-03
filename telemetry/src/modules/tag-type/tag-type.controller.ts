import type { Request, Response } from 'express'
import type { SuccessResponse } from '../../core/types/index.js'
import type { ITagType } from './tag-type.model.js'
import * as tagTypeService from './tag-type.service.js'

export const createTagType = async (req: Request, res: Response<SuccessResponse<ITagType>>) => {
  const tagType = await tagTypeService.createTagType(req.body)

  res.status(201).json({
    data: tagType,
    message: req.t('success.create'),
  })
}

export const getTagTypes = async (_req: Request, res: Response<SuccessResponse<ITagType[]>>) => {
  const tagTypes = await tagTypeService.getTagTypes()

  res.json({
    data: tagTypes,
  })
}

export const getTagTypeById = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<ITagType>>,
) => {
  const tagType = await tagTypeService.getTagTypeById(req.params.id)

  res.json({
    data: tagType,
  })
}

export const updateTagType = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<ITagType>>,
) => {
  const tagType = await tagTypeService.updateTagType(req.params.id, req.body)

  res.json({
    data: tagType,
    message: req.t('success.update'),
  })
}

export const deleteTagType = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse>,
) => {
  await tagTypeService.deleteTagType(req.params.id)

  res.json({
    data: undefined,
    message: req.t('success.delete'),
  })
}
