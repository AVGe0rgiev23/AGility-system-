import { z } from 'zod'
import { DeliveryModelSchema } from './company'
import { EstimateResultSchema, ROIResultSchema, RunCostResultSchema } from './results'
import { RunCostLineItemSchema } from './run-cost'

export const DeliverableSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  // The guarantee lives or dies here: each criterion must be observable and binary.
  // An empty list is storable so drafts save; the proposal render refuses it.
  acceptanceCriteria: z.array(z.string()),
  opportunityId: z.string().optional(),
})
export type Deliverable = z.infer<typeof DeliverableSchema>

export const PhaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  order: z.number(),
  estimatedWeeks: z.number(),
})
export type Phase = z.infer<typeof PhaseSchema>

export const ProjectScopeSchema = z.object({
  selectedOpportunityIds: z.array(z.string()),
  deliveryModel: DeliveryModelSchema,
  deliverables: z.array(DeliverableSchema),
  exclusions: z.array(z.string()),
  assumptions: z.array(z.string()),
  phases: z.array(PhaseSchema),
  // EUR, chosen from the Config support band. Null means no retainer has been set yet.
  supportRetainerMonthly: z.number().nullable(),
  // Per-engagement, seeded from Config.runCostDefaults.
  runCostItems: z.array(RunCostLineItemSchema),
  estimate: EstimateResultSchema.nullable(),
  runCost: RunCostResultSchema.nullable(),
  // Computed over the selected set: clients buy projects, not line items.
  roi: ROIResultSchema.nullable(),
})
export type ProjectScope = z.infer<typeof ProjectScopeSchema>

// Artifacts are never stored as text, only as a template plus section overrides.
export const ArtifactRefSchema = z.object({
  templateId: z.string(),
  overrides: z.array(
    z.object({
      sectionId: z.string(),
      content: z.string(),
      editedAt: z.string(),
      // Detects upstream drift since the edit and triggers the conflict UI.
      baseInputsHash: z.string(),
    }),
  ),
  lastRenderedAt: z.string().nullable(),
  sentAt: z.string().nullable(),
  version: z.number(),
})
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>

export const ArtifactSetSchema = z.object({
  teardown: ArtifactRefSchema.nullable(),
  proposal: ArtifactRefSchema.nullable(),
  sow: ArtifactRefSchema.nullable(),
  projectPlan: ArtifactRefSchema.nullable(),
  handoverDocs: ArtifactRefSchema.nullable(),
  caseStudy: ArtifactRefSchema.nullable(),
})
export type ArtifactSet = z.infer<typeof ArtifactSetSchema>

export const TaskSchema = z.object({
  id: z.string(),
  phaseId: z.string(),
  title: z.string(),
  // Calibration write-back groups actual hours by this id; without it the task teaches nothing.
  patternId: z.string().optional(),
  estimatedHours: z.number(),
  // Null until logged. A project cannot be marked delivered while any task is still null.
  actualHours: z.number().nullable(),
  status: z.enum(['todo', 'doing', 'blocked', 'done']),
  blockedReason: z.string().optional(),
})
export type Task = z.infer<typeof TaskSchema>

export const TimeEntrySchema = z.object({
  id: z.string(),
  taskId: z.string(),
  minutes: z.number(),
  at: z.string(),
  note: z.string().optional(),
})
export type TimeEntry = z.infer<typeof TimeEntrySchema>

export const ProjectSchema = z.object({
  startedAt: z.string(),
  phases: z.array(PhaseSchema),
  tasks: z.array(TaskSchema),
  timeLog: z.array(TimeEntrySchema),
  status: z.enum(['active', 'paused', 'delivered', 'in-support']),
  deliveredAt: z.string().nullable(),
})
export type Project = z.infer<typeof ProjectSchema>
