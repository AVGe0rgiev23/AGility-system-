import { z } from 'zod'
import { addListEntryIssues } from './list-rules'
import { TracedValueSchema } from './traced'

export const ProcessStepSchema = z
  .object({
    id: z.string(),
    action: z.string(),
    system: z.string().optional(),
    isManual: z.boolean(),
    isBottleneck: z.boolean(),
    waitTimeMinutes: z.number().optional(),
  })
  .superRefine((step, ctx) => {
    // A step is read by what it does, in the editor and in the blueprint it becomes.
    if (step.action.trim() === '') ctx.addIssue({ code: 'custom', path: ['action'], message: 'A step needs an action' })
    // Absent is the empty value, so a blank system is refused like any other malformed one.
    if (step.system !== undefined && step.system.trim() === '') {
      ctx.addIssue({ code: 'custom', path: ['system'], message: 'A step either names a system or has none' })
    }
    // A wait is time spent waiting; a negative one would shorten the process it is part of.
    if (step.waitTimeMinutes !== undefined && step.waitTimeMinutes < 0) {
      ctx.addIssue({ code: 'custom', path: ['waitTimeMinutes'], message: 'A wait cannot be negative' })
    }
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
}).superRefine((process, ctx) => {
  // Every table, opportunity link and document names the process.
  if (process.name.trim() === '') ctx.addIssue({ code: 'custom', path: ['name'], message: 'A process needs a name' })

  addListEntryIssues(ctx, process.systemsTouched, ['systemsTouched'], 'system')
  addListEntryIssues(ctx, process.painPoints, ['painPoints'], 'pain point')

  // Scoring reads the rate as a share of the runs that go wrong (ENGINES §1.1), so past 100 it would
  // claim more failures than there are runs and inflate the error value it feeds.
  const { errorRatePercent } = process.errorProfile
  if (errorRatePercent !== null && errorRatePercent.value > 100) {
    ctx.addIssue({ code: 'custom', path: ['errorProfile', 'errorRatePercent', 'value'], message: 'An error rate is a share of the runs, so it is at most 100' })
  }
})
export type Process = z.infer<typeof ProcessSchema>
