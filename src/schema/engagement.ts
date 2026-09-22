import { z } from 'zod'
import { BlueprintSchema } from './blueprint'
import { CompanySchema, ContactSchema, TimestampedNoteSchema } from './company'
import { DiscoverySessionSchema } from './discovery'
import { OpportunitySchema } from './opportunity'
import { ProcessSchema } from './process'
import { ArtifactSetSchema, ProjectSchema, ProjectScopeSchema } from './scope'

const IsoDateSchema = z.iso.date()

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
      // A calendar date, YYYY-MM-DD, so due dates compare as strings.
      due: z.string().optional(),
    })
    .nullable(),
}).superRefine((engagement, ctx) => {
  // An opportunity links to a process by id, the scope selects an opportunity by id, and the engagement
  // form re-joins each cached score by id. A repeat would make every one of those name two records.
  const uniqueIds = (records: readonly { id: string }[], key: 'processes' | 'opportunities', noun: string) => {
    const seen = new Set<string>()
    for (const [index, record] of records.entries()) {
      if (seen.has(record.id)) {
        ctx.addIssue({ code: 'custom', path: [key, index, 'id'], message: `${noun} id '${record.id}' is already used` })
      }
      seen.add(record.id)
    }
  }
  uniqueIds(engagement.processes, 'processes', 'Process')
  uniqueIds(engagement.opportunities, 'opportunities', 'Opportunity')

  // The list filters by tag, so a blank tag or the same tag twice would filter nothing sensible.
  const seen = new Set<string>()
  for (const [index, tag] of engagement.tags.entries()) {
    if (tag.trim() === '') {
      ctx.addIssue({ code: 'custom', path: ['tags', index], message: 'A tag cannot be blank' })
    } else if (seen.has(tag)) {
      ctx.addIssue({ code: 'custom', path: ['tags', index], message: `The tag '${tag}' is already used` })
    }
    seen.add(tag)
  }
  const { nextAction } = engagement
  if (nextAction === null) return
  if (nextAction.text.trim() === '') {
    ctx.addIssue({ code: 'custom', path: ['nextAction', 'text'], message: 'A next action needs text' })
  }
  if (nextAction.due !== undefined && !IsoDateSchema.safeParse(nextAction.due).success) {
    ctx.addIssue({ code: 'custom', path: ['nextAction', 'due'], message: `'${nextAction.due}' is not a calendar date written as YYYY-MM-DD` })
  }
})
export type Engagement = z.infer<typeof EngagementSchema>
