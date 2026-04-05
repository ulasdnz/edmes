import { z } from 'zod'

export const discoveryQuerySchema = z.object({
  availableOnly: z.enum(['true', 'false']).default('false'),
})

export type DiscoveryQuery = z.infer<typeof discoveryQuerySchema>
