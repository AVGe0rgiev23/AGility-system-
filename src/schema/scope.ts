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
  // The single source of truth for what is in scope; the estimate, run cost and ROI cover exactly these.
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

// A resolved leaf value as a template section reads it. Snapshots hold leaves only, never an
// object or an array, so a snapshot stays small and every entry is a value that can be diffed.
export const RenderScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
export type RenderScalar = z.infer<typeof RenderScalarSchema>

export const SectionOverrideSchema = z.object({
  sectionId: z.string(),
  content: z.string(),
  editedAt: z.string(),
  // Hash of exactly the values the section read when it was edited. Detects upstream drift
  // since the edit and triggers the conflict UI.
  baseInputsHash: z.string(),
  // Those values themselves, keyed by absolute path, so a conflict can show old against new.
  // Null when unavailable: an override migrated from before v3, or a section that read more
  // paths than the render layer is willing to store.
  baseInputs: z.record(z.string(), RenderScalarSchema).nullable(),
  // The baseInputsHash this edit was kept over when Alex chose it against changed data. A
  // trail of an edit that survived a data change without being rewritten. Null for a fresh edit.
  rebasedFrom: z.string().nullable(),
})
export type SectionOverride = z.infer<typeof SectionOverrideSchema>

// Artifacts are never stored as text, only as a template plus section overrides.
export const ArtifactRefSchema = z.object({
  templateId: z.string(),
  overrides: z.array(SectionOverrideSchema),
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
  // Summed per pattern into calibration samples, where a negative figure would skew the ratio.
  estimatedHours: z.number().nonnegative(),
  // Null until logged. A project cannot be marked delivered while any task is still null.
  actualHours: z.number().nonnegative().nullable(),
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
