import { z } from 'zod'

export const MetaSchema = z.object({
  // The only version in the system; records never carry their own. Migrations step one
  // whole version at a time from v1, so anything but a positive integer is corrupt.
  schemaVersion: z.int().min(1),
  createdAt: z.string(),
  lastMigratedAt: z.string().nullable(),
  appVersion: z.string(),
})
export type Meta = z.infer<typeof MetaSchema>
