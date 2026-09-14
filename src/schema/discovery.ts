import { z } from 'zod'
import { TracedValueSchema } from './traced'

// A free-string path would let a typo silently drop a client's answer.
export const MAPPABLE_PATHS = [
  'company.blendedHourlyCost',
  'company.employeeCount',
  'company.industry',
  'company.sourceOfTruth',
  'company.statedTools',
  'company.constraints.compliance',
  'company.preferredDeliveryModel',
  // Process-scoped paths resolve against the process created by this session.
  'process.frequency.occurrencesPerMonth',
  'process.frequency.minutesPerOccurrence',
  'process.frequency.peopleInvolved',
  'process.errorProfile.errorRatePercent',
  'process.errorProfile.costPerError',
  'process.revenueImpact',
  'process.roleHourlyCost',
] as const

export type MappablePath = (typeof MAPPABLE_PATHS)[number]

export const MappablePathSchema = z.enum(MAPPABLE_PATHS, {
  error: (issue) => `'${String(issue.input)}' is not a mappable path`,
})

export const ConditionSchema = z.union([
  z.object({ answerId: z.string(), equals: z.union([z.string(), z.number(), z.boolean()]) }),
  z.object({ answerId: z.string(), gt: z.number() }),
  z.object({ answerId: z.string(), includes: z.string() }),
  z.object({
    get all() {
      return z.array(ConditionSchema)
    },
  }),
  z.object({
    get any() {
      return z.array(ConditionSchema)
    },
  }),
])
export type Condition = z.infer<typeof ConditionSchema>

export const AnswerSchema = z.object({
  id: z.string(),
  questionId: z.string(),
  kind: z.enum(['text', 'number', 'choice', 'multi', 'boolean', 'duration']),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
  // Present when the answer is a figure.
  traced: TracedValueSchema.optional(),
  followUpTriggered: z.array(z.string()),
  flags: z.array(z.enum(['pain', 'blocker', 'opportunity', 'risk'])),
})
export type Answer = z.infer<typeof AnswerSchema>

export const DiscoverySessionSchema = z.object({
  id: z.string(),
  kind: z.enum(['teardown', 'discovery', 'technical', 'follow-up']),
  questionSetId: z.string(),
  heldAt: z.string(),
  attendees: z.array(z.string()),
  answers: z.array(AnswerSchema),
  // Freeform, always allowed alongside typed answers.
  rawNotes: z.string(),
  completeness: z.number().min(0).max(100),
})
export type DiscoverySession = z.infer<typeof DiscoverySessionSchema>

export const QuestionSchema = z.object({
  id: z.string(),
  text: z.string(),
  kind: AnswerSchema.shape.kind,
  helpText: z.string().optional(),
  choices: z.array(z.string()).optional(),
  required: z.boolean(),
  showIf: ConditionSchema.optional(),
  mapsTo: MappablePathSchema.optional(),
  suggestsPatterns: z.array(z.string()).optional(),
})
export type Question = z.infer<typeof QuestionSchema>

export const QuestionSetSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: DiscoverySessionSchema.shape.kind,
  appliesTo: z.object({
    industries: z.array(z.string()).optional(),
    minEmployees: z.number().optional(),
  }),
  questions: z.array(QuestionSchema),
})
export type QuestionSet = z.infer<typeof QuestionSetSchema>
