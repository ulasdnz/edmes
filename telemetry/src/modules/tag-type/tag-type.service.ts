import CustomError from '../../core/errors/index.js'
import { emitTagTypeCreated, emitTagTypeDeleted, emitTagTypeUpdated } from '../../jobs/events.js'
import TagType from './tag-type.model.js'
import type { CreateTagTypeInput, UpdateTagTypeInput } from './tag-type.validators.js'

export const createTagType = async (data: CreateTagTypeInput) => {
  const existing = await TagType.findOne({ name: data.name })
  if (existing) {
    throw new CustomError(409, 'tag_type.name_in_use')
  }

  const tagType = await TagType.create(data)
  await emitTagTypeCreated(tagType._id.toString())
  return tagType
}

export const getTagTypes = async () => TagType.find().select('-__v').lean()

export const getTagTypeById = async (id: string) => {
  const tagType = await TagType.findById(id).select('-__v').lean()
  if (!tagType) {
    throw new CustomError(404, 'tag_type.not_found')
  }
  return tagType
}

export const updateTagType = async (id: string, data: UpdateTagTypeInput) => {
  if (data.name) {
    const existing = await TagType.findOne({ name: data.name, _id: { $ne: id } })
    if (existing) {
      throw new CustomError(409, 'tag_type.name_in_use')
    }
  }

  const tagType = await TagType.findByIdAndUpdate(
    id,
    { $set: data },
    { returnDocument: 'after', runValidators: true },
  )
  if (!tagType) {
    throw new CustomError(404, 'tag_type.not_found')
  }

  await emitTagTypeUpdated(tagType._id.toString())
  return tagType
}

export const deleteTagType = async (id: string) => {
  const tagType = await TagType.findByIdAndDelete(id)
  if (!tagType) {
    throw new CustomError(404, 'tag_type.not_found')
  }
  await emitTagTypeDeleted(id)
}
