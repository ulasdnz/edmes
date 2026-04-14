import mongoose from 'mongoose'
import CustomError from '../../core/errors/index.js'
import { emitTagCreated, emitTagDeleted, emitTagUpdated } from '../../jobs/events.js'
import { bindingCacheDelete, bindingCacheSet } from '../ingestion/binding-cache.js'
import Tag from './tag.model.js'
import type { CreateTagInput, UpdateTagInput } from './tag.validators.js'

export const createTag = async (data: CreateTagInput) => {
  if (data.binding?.nodeId) {
    const existing = await Tag.findOne({
      'binding.deviceKey': data.binding.deviceKey,
      'binding.nodeId': data.binding.nodeId,
    })
    if (existing) {
      throw new CustomError(409, 'tag.binding_in_use')
    }
  }

  const tag = await Tag.create(data)
  if (tag.binding?.nodeId) {
    bindingCacheSet(tag)
  }
  await emitTagCreated(tag._id.toString())
  return tag
}

export const getTags = async () => Tag.find().select('-__v').lean()

export const getTagById = async (id: string) => {
  const tag = await Tag.findById(id).select('-__v').lean()
  if (!tag) {
    throw new CustomError(404, 'tag.not_found')
  }
  return tag
}

export const updateTag = async (id: string, data: UpdateTagInput) => {
  const existingTag = await Tag.findById(id)
  if (!existingTag) {
    throw new CustomError(404, 'tag.not_found')
  }

  if (data.binding?.nodeId) {
    const existing = await Tag.findOne({
      'binding.deviceKey': data.binding.deviceKey,
      'binding.nodeId': data.binding.nodeId,
      _id: { $ne: id },
    })
    if (existing) {
      throw new CustomError(409, 'tag.binding_in_use')
    }
  }

  const tag = await Tag.findByIdAndUpdate(
    id,
    { $set: data },
    { returnDocument: 'after', runValidators: true },
  )
  if (!tag) {
    throw new CustomError(404, 'tag.not_found')
  }

  if (existingTag.binding?.nodeId) {
    bindingCacheDelete(existingTag.binding.deviceKey, existingTag.binding.nodeId)
  }
  if (tag.binding?.nodeId) {
    bindingCacheSet(tag)
  }

  await emitTagUpdated(tag._id.toString())
  return tag
}

export const deleteTag = async (id: string, forceDelete = false) => {
  const tag = await Tag.findById(id)
  if (!tag) {
    throw new CustomError(404, 'tag.not_found')
  }

  if (tag.binding?.nodeId) {
    bindingCacheDelete(tag.binding.deviceKey, tag.binding.nodeId)
  }

  const collectionName = `tag_samples_${id}`
  const collections = await mongoose.connection
    .db!.listCollections({ name: collectionName })
    .toArray()

  if (collections.length > 0) {
    const collection = mongoose.connection.db!.collection(collectionName)
    const count = await collection.countDocuments({}, { limit: 1 })

    if (count > 0 && !forceDelete) {
      throw new CustomError(409, 'tag.has_historian_data')
    }

    if (forceDelete) {
      await collection.drop()
    }
  }

  await Tag.findByIdAndDelete(id)
  await emitTagDeleted(id)
}
