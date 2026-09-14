import { z } from 'zod'
import { BlueprintSchema } from './blueprint'
import { QuestionSetSchema } from './discovery'

export const PatternSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  // Client-facing.
  problem: z.string(),
  // Client-facing.
  solution: z.string(),
  // Technical.
  architecture: z.string(),
  requiredIntegrations: z.array(z.string()),
  complexity: z.enum(['low', 'medium', 'high']),
  // Uncalibrated. Calibration is applied in estimation only; applying it here as
  // well would compound the multiplier and inflate every quote. Positive, because
  // a linked pattern at zero hours would make its build free in every estimate.
  baseHours: z.number().positive(),
  risks: z.array(z.string()),
  // Drops straight into proposals.
  clientExplanation: z.string(),
  // A skeleton belongs to no engagement yet, so it has no id or opportunityId.
  blueprintSkeleton: BlueprintSchema.omit({ id: true, opportunityId: true }).nullable(),
  codeNotes: z.string(),
  usedInEngagements: z.array(z.string()),
})
export type Pattern = z.infer<typeof PatternSchema>

export const CalibrationRecordSchema = z.object({
  patternId: z.string(),
  samples: z.array(
    z.object({
      engagementId: z.string(),
      estimatedHours: z.number(),
      actualHours: z.number(),
      completedAt: z.string(),
    }),
  ),
  // Computed by the calibration engine (ENGINES §5), never entered by hand.
  multiplier: z.number(),
  sampleCount: z.number(),
  trustworthy: z.boolean(),
})
export type CalibrationRecord = z.infer<typeof CalibrationRecordSchema>

export const TemplateSectionSchema = z.object({
  id: z.string(),
  heading: z.string(),
  // Mustache-style, resolved against a view model.
  body: z.string(),
  // Path expression; the section is omitted when it resolves falsy.
  showIf: z.string().optional(),
  // A collection path such as 'scope.deliverables'.
  repeatOver: z.string().optional(),
})
export type TemplateSection = z.infer<typeof TemplateSectionSchema>

export const DocumentTemplateSchema = z.object({
  id: z.string(),
  kind: z.enum(['teardown', 'proposal', 'sow', 'project-plan', 'handover', 'case-study']),
  name: z.string(),
  sections: z.array(TemplateSectionSchema),
})
export type DocumentTemplate = z.infer<typeof DocumentTemplateSchema>

// Global and cross-client, unlike engagements.
export const LibrarySchema = z.object({
  patterns: z.array(PatternSchema),
  questionSets: z.array(QuestionSetSchema),
  templates: z.array(DocumentTemplateSchema),
  calibration: z.array(CalibrationRecordSchema),
})
export type Library = z.infer<typeof LibrarySchema>
