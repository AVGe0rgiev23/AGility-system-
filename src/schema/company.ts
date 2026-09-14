import { z } from 'zod'
import { CurrencySchema, TracedValueSchema } from './traced'

export const DeliveryModelSchema = z.enum(['fully-managed', 'client-owned', 'hybrid'])
export type DeliveryModel = z.infer<typeof DeliveryModelSchema>

export const DetectedToolSchema = z.object({
  name: z.string(),
  category: z.string(),
  evidence: z.string().max(80),
  confidence: z.enum(['high', 'medium', 'low']),
  // Signal extraction only suggests; a tool counts once Alex confirms it.
  confirmed: z.boolean(),
})
export type DetectedTool = z.infer<typeof DetectedToolSchema>

export const ContactSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  isDecisionMaker: z.boolean(),
  notes: z.string().optional(),
})
export type Contact = z.infer<typeof ContactSchema>

export const TimestampedNoteSchema = z.object({
  id: z.string(),
  at: z.string(),
  body: z.string(),
  tags: z.array(z.string()),
})
export type TimestampedNote = z.infer<typeof TimestampedNoteSchema>

export const CompanySchema = z.object({
  name: z.string(),
  website: z.string().optional(),
  industry: z.string(),
  employeeCount: z.number().optional(),
  locationCountry: z.string().optional(),
  currency: CurrencySchema,
  // Blended cost, not salary. A Process may override it with a role-specific rate.
  blendedHourlyCost: TracedValueSchema.nullable(),
  detectedStack: z.array(DetectedToolSchema),
  statedTools: z.array(z.string()),
  sourceOfTruth: z.string().optional(),
  constraints: z.object({
    compliance: z.array(z.string()),
    dataResidency: z.string().optional(),
    securityNotes: z.string().optional(),
  }),
  preferredDeliveryModel: DeliveryModelSchema.optional(),
})
export type Company = z.infer<typeof CompanySchema>
