import { z } from 'zod'
import { ScoringResultSchema } from './results'
import { TracedValueSchema } from './traced'

export const EffortInputsSchema = z.object({
  integrations: z.array(
    z.object({
      name: z.string(),
      hasPublicApi: z.boolean(),
      authAvailable: z.boolean(),
      notes: z.string().optional(),
    }),
  ),
  dataReadiness: z.enum(['structured', 'semi-structured', 'unstructured']),
  // A count of steps, each worth effort points: a fraction or a negative has no meaning.
  approvalSteps: z.int().min(0),
  complianceFlags: z.array(z.string()),
  volumeTier: z.enum(['low', 'medium', 'high']),
  novelty: z.enum(['known-pattern', 'similar-pattern', 'new']),
  requiresHumanInLoop: z.boolean(),
})
export type EffortInputs = z.infer<typeof EffortInputsSchema>

// No roi field: ROI is computed over the selected set and lives on ProjectScope.
export const OpportunitySchema = z.object({
  id: z.string(),
  processIds: z.array(z.string()),
  title: z.string(),
  // Client-facing, one paragraph.
  summary: z.string(),
  patternIds: z.array(z.string()),
  // Drives calibration in estimation.
  primaryPatternId: z.string().nullable(),
  automatablePercent: TracedValueSchema,
  errorReductionPercent: TracedValueSchema,
  effortInputs: EffortInputsSchema,
  scoring: ScoringResultSchema.nullable(),
  selected: z.boolean(),
})
export type Opportunity = z.infer<typeof OpportunitySchema>
