import { z } from 'zod'
import { addListEntryIssues } from './list-rules'
import { CurrencySchema, TracedValueSchema } from './traced'

// Client websites may still be plain http, unlike the agency's own, which must be https.
const WebsiteSchema = z.url({ protocol: /^https?$/, hostname: z.regexes.domain })
const EmailSchema = z.email()

export const DeliveryModelSchema = z.enum(['fully-managed', 'client-owned', 'hybrid'])
export type DeliveryModel = z.infer<typeof DeliveryModelSchema>

export const DetectedToolSchema = z
  .object({
    name: z.string(),
    category: z.string(),
    evidence: z.string().max(80),
    confidence: z.enum(['high', 'medium', 'low']),
    // Signal extraction only suggests; a tool counts once Alex confirms it.
    confirmed: z.boolean(),
  })
  .superRefine((tool, ctx) => {
    // A suggestion is confirmed, merged and printed by its name, and shown under its category.
    if (tool.name.trim() === '') ctx.addIssue({ code: 'custom', path: ['name'], message: 'A detected tool needs a name' })
    if (tool.category.trim() === '') ctx.addIssue({ code: 'custom', path: ['category'], message: 'A detected tool needs a category' })
  })
export type DetectedTool = z.infer<typeof DetectedToolSchema>

export const ContactSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    role: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    isDecisionMaker: z.boolean(),
    notes: z.string().optional(),
  })
  .superRefine((contact, ctx) => {
    // A contact is picked by name everywhere it appears.
    if (contact.name.trim() === '') {
      ctx.addIssue({ code: 'custom', path: ['name'], message: 'A contact needs a name' })
    }
    // Absent means no address. An empty or malformed one would be written into a document as if real.
    if (contact.email !== undefined && !EmailSchema.safeParse(contact.email).success) {
      ctx.addIssue({ code: 'custom', path: ['email'], message: `'${contact.email}' is not a valid email address` })
    }
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
}).superRefine((company, ctx) => {
  // The list, the engagement's folder name and every proposal are headed by it.
  if (company.name.trim() === '') {
    ctx.addIssue({ code: 'custom', path: ['name'], message: 'The company needs a name' })
  }
  // Printed on documents. The URL parser trims whitespace, so a padded value would pass it yet print padded.
  const { website } = company
  if (website !== undefined && (website.trim() !== website || !WebsiteSchema.safeParse(website).success)) {
    ctx.addIssue({ code: 'custom', path: ['website'], message: `'${website}' is not a valid http:// or https:// URL` })
  }
  const { employeeCount } = company
  if (employeeCount !== undefined && (!Number.isInteger(employeeCount) || employeeCount < 0)) {
    ctx.addIssue({ code: 'custom', path: ['employeeCount'], message: 'The employee count must be a whole number, at least 0' })
  }
  // Stated tools feed signal extraction, and each compliance requirement adds effort points to every
  // opportunity it reaches, so a blank or repeated entry would count for nothing.
  addListEntryIssues(ctx, company.statedTools, ['statedTools'], 'stated tool')
  addListEntryIssues(ctx, company.constraints.compliance, ['constraints', 'compliance'], 'compliance requirement')

  // Merging a fresh extraction into the stack keys on the name, so a repeat would hide one behind the
  // other, and confirming either would leave the same name both confirmed and not.
  const seenTools = new Set<string>()
  for (const [index, tool] of company.detectedStack.entries()) {
    if (seenTools.has(tool.name)) {
      ctx.addIssue({ code: 'custom', path: ['detectedStack', index, 'name'], message: `The tool '${tool.name}' is already detected` })
    }
    seenTools.add(tool.name)
  }
})
export type Company = z.infer<typeof CompanySchema>
