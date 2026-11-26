import { rolePaths } from '../../modules/role/role.openapi.js'
import { specialityPaths } from '../../modules/speciality/speciality.openapi.js'
import { userPaths } from '../../modules/user/user.openapi.js'
import { generateOpenApiDocument } from './setup.js'

export const openApiDocument = generateOpenApiDocument({
  ...userPaths,
  ...rolePaths,
  ...specialityPaths,
})
