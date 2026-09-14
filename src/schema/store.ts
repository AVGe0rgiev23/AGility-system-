import { z } from 'zod'
import { ConfigSchema } from './config'
import { EngagementSchema } from './engagement'
import { LibrarySchema } from './library'
import { MetaSchema } from './meta'

// The unit that migrations and export/import operate on, atomically, never record by record.
export const WholeStoreSchema = z.object({
  meta: MetaSchema,
  config: ConfigSchema,
  library: LibrarySchema,
  engagements: z.array(EngagementSchema),
})
export type WholeStore = z.infer<typeof WholeStoreSchema>
