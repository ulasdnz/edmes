import CustomError from '../../core/errors/index.js'
import Speciality from './speciality.model.js'
import type { CreateSpecialityInput, UpdateSpecialityInput } from './speciality.validators.js'

export const createSpeciality = async (data: CreateSpecialityInput) => {
  const existing = await Speciality.findOne({ name: data.name })
  if (existing) {
    throw new CustomError(409, 'speciality.name_in_use')
  }

  return Speciality.create(data)
}

export const getSpecialities = async () => Speciality.find().lean()

export const getSpecialityById = async (id: string) => {
  const speciality = await Speciality.findById(id).lean()
  if (!speciality) {
    throw new CustomError(404, 'speciality.not_found')
  }

  return speciality
}

export const updateSpeciality = async (id: string, data: UpdateSpecialityInput) => {
  if (data.name) {
    const existing = await Speciality.findOne({ name: data.name, _id: { $ne: id } })
    if (existing) {
      throw new CustomError(409, 'speciality.name_in_use')
    }
  }

  const speciality = await Speciality.findByIdAndUpdate(
    id,
    { $set: data },
    { new: true, runValidators: true },
  )
  if (!speciality) {
    throw new CustomError(404, 'speciality.not_found')
  }

  return speciality
}

export const deleteSpeciality = async (id: string) => {
  const speciality = await Speciality.findByIdAndDelete(id)
  if (!speciality) {
    throw new CustomError(404, 'speciality.not_found')
  }
}
