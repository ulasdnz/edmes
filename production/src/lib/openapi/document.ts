import { jobOrderPaths } from '../../modules/job-order/job-order.openapi.js'
import { generateOpenApiDocument } from './setup.js'

export const openApiDocument = generateOpenApiDocument(jobOrderPaths)
