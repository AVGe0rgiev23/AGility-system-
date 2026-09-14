import { z } from 'zod'
import { TracedValueSchema } from './traced'

export const ProcessStepSchema = z.object({
  id: z.string(),
  action: z.string(),
  system: z.string().optional(),
  isManual: z.boolean(),
  isBottleneck: z.boolean(),
  waitTimeMinutes: z.number().optional(),
})
export type ProcessStep = z.infer<typeof ProcessStepSchema>

export const ProcessSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  owner: z.string().optional(),
  frequency: z.object({
    occurrencesPerMonth: TracedValueSchema,
    minutesPerOccurrence: TracedValueSchema,
    peopleInvolved: TracedValueSchema,
  }),
  // Overrides company.blendedHourlyCost: a warehouse clerk and a finance manager do not cost the same.
  roleHourlyCost: TracedValueSchema.nullable(),
  steps: z.array(ProcessStepSchema),
  systemsTouched: z.array(z.string()),
  painPoints: z.array(z.string()),
  errorProfile: z.object({
    errorRatePercent: TracedValueSchema.nullable(),
    costPerError: TracedValueSchema.nullable(),
    errorDescription: z.string().optional(),
  }),
  revenueImpact: z.enum(['direct', 'indirect', 'none']),
  customerFacing: z.boolean(),
})
export type Process = z.infer<typeof ProcessSchema>
