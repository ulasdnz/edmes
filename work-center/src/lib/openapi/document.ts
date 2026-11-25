import { workCenterPaths } from '../../modules/work-center/work-center.openapi.js'
import { generateOpenApiDocument } from './setup.js'

export const openApiDocument = generateOpenApiDocument(workCenterPaths)
