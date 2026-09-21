import { z } from 'zod'
import { addListEntryIssues } from './list-rules'
import { ScoringResultSchema } from './results'
import { TracedValueSchema } from './traced'

export const EffortInputsSchema = z
  .object({
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
  .superRefine((inputs, ctx) => {
    // Each integration is worth effort points (ENGINES §1.2) and is named in the working, so an unnamed
    // one adds hours nobody can account for.
    for (const [index, integration] of inputs.integrations.entries()) {
      if (integration.name.trim() === '') {
        ctx.addIssue({ code: 'custom', path: ['integrations', index, 'name'], message: 'An integration needs a name' })
      }
    }
    addListEntryIssues(ctx, inputs.complianceFlags, ['complianceFlags'], 'compliance flag')
  })
export type EffortInputs = z.infer<typeof EffortInputsSchema>

// No roi field: ROI is computed over the selected set and lives on ProjectScope. No selected
// flag either: ProjectScope.selectedOpportunityIds is the only record of what is in scope, since
// two records of it could disagree and price a different set from the one shown.
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
}).superRefine((opportunity, ctx) => {
  // It heads the ranked table, the scope and every document the opportunity reaches.
  if (opportunity.title.trim() === '') ctx.addIssue({ code: 'custom', path: ['title'], message: 'An opportunity needs a title' })

  // Scoring sums the value of each linked process and the base hours of each linked pattern
  // (ENGINES §1.1, §1.2), so a repeat would count one of them twice.
  const linkedOnce = (ids: readonly string[], key: 'processIds' | 'patternIds', noun: string) => {
    const seen = new Set<string>()
    for (const id of ids) {
      if (seen.has(id)) ctx.addIssue({ code: 'custom', path: [key], message: `The ${noun} '${id}' is linked more than once` })
      seen.add(id)
    }
  }
  linkedOnce(opportunity.processIds, 'processIds', 'process')
  linkedOnce(opportunity.patternIds, 'patternIds', 'pattern')

  // Estimation calibrates by the primary pattern alone (ENGINES §2) while scoring costs the linked
  // ones, so a primary outside that list would calibrate hours no pattern here contributed.
  const { primaryPatternId } = opportunity
  if (primaryPatternId !== null && !opportunity.patternIds.includes(primaryPatternId)) {
    ctx.addIssue({ code: 'custom', path: ['primaryPatternId'], message: `The primary pattern '${primaryPatternId}' is not one of the linked patterns` })
  }

  // Both are divided by 100 and multiplied into a client-facing figure (ENGINES §1.1), so past their
  // whole they would recover more work, or prevent more errors, than there are.
  const share = (traced: { value: number }, key: 'automatablePercent' | 'errorReductionPercent', noun: string) => {
    if (traced.value > 100) ctx.addIssue({ code: 'custom', path: [key, 'value'], message: `${noun} is a share of the whole, so it is at most 100` })
  }
  share(opportunity.automatablePercent, 'automatablePercent', 'The automatable share')
  share(opportunity.errorReductionPercent, 'errorReductionPercent', 'The error reduction')
})
export type Opportunity = z.infer<typeof OpportunitySchema>
