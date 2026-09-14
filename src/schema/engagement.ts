import { z } from 'zod'
import { BlueprintSchema } from './blueprint'
import { CompanySchema, ContactSchema, TimestampedNoteSchema } from './company'
import { DiscoverySessionSchema } from './discovery'
import { OpportunitySchema } from './opportunity'
import { ProcessSchema } from './process'
import { ArtifactSetSchema, ProjectSchema, ProjectScopeSchema } from './scope'

export const StageSchema = z.enum([
  'LEAD',
  'TEARDOWN',
  'RESEARCH',
  'DISCOVERY',
  'QUALIFIED',
  'PROPOSAL',
  'NEGOTIATION',
  'WON',
  'IMPLEMENTATION',
  'RETAINER',
  'LOST',
  // Not LOST: Alex told them custom software was not the right answer. A positioning
  // asset and a future re-engagement list, so it is tracked separately.
  'DECLINED',
])
export type Stage = z.infer<typeof StageSchema>

export const LeadSourceSchema = z.enum([
  'teardown',
  'inbound-form',
  'linkedin',
  'referral',
  'outbound',
  'repeat',
  'other',
])
export type LeadSource = z.infer<typeof LeadSourceSchema>

// One record per company. Every artifact is a render of this record.
// Records carry no version of their own: the single schema version lives in Meta.
export const EngagementSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),

  company: CompanySchema,
  contacts: z.array(ContactSchema),
  stage: StageSchema,
  source: LeadSourceSchema,
  stageHistory: z.array(
    z.object({
      stage: StageSchema,
      at: z.string(),
      note: z.string().optional(),
    }),
  ),

  discovery: z.array(DiscoverySessionSchema),
  processes: z.array(ProcessSchema),
  opportunities: z.array(OpportunitySchema),
  blueprints: z.array(BlueprintSchema),

  // Set once opportunities are selected.
  scope: ProjectScopeSchema.nullable(),
  artifacts: ArtifactSetSchema,
  // Exists once the engagement is WON.
  project: ProjectSchema.nullable(),

  tags: z.array(z.string()),
  notes: z.array(TimestampedNoteSchema),
  nextAction: z
    .object({
      text: z.string(),
      due: z.string().optional(),
    })
    .nullable(),
})
export type Engagement = z.infer<typeof EngagementSchema>
