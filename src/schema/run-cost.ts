import { z } from 'zod'
import { DeliveryModelSchema } from './company'

export const RunCostLineItemSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    category: z.enum([
      'hosting',
      'database',
      'scheduler',
      'ai',
      'monitoring',
      'domain',
      'third-party',
      'other',
    ]),
    // EUR. Required unless usageBased, when the formula prices the item and this is ignored. A
    // required figure that is then ignored invites a plausible number typed only to get past it,
    // which the item inherits the day it stops being usage-based.
    monthlyCost: z.number().nullable(),
    paidBy: z.record(DeliveryModelSchema, z.enum(['client', 'agency', 'not-applicable'])),
    notes: z.string().optional(),
    usageBased: z.boolean(),
    usageFormula: z
      .object({
        callsPerMonth: z.number(),
        avgInputTokens: z.number(),
        avgOutputTokens: z.number(),
        inputPricePerMTok: z.number(),
        outputPricePerMTok: z.number(),
      })
      .optional(),
  })
  .superRefine((item, ctx) => {
    // The run-cost engine prices usage-based items from the formula alone.
    if (item.usageBased && item.usageFormula === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['usageFormula'],
        message: 'usageFormula is required when usageBased is true',
      })
    }
    // A fixed item is priced from its monthly cost alone, so it cannot go without one.
    if (!item.usageBased && item.monthlyCost === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['monthlyCost'],
        message: 'monthlyCost is required when usageBased is false',
      })
    }
  })
export type RunCostLineItem = z.infer<typeof RunCostLineItemSchema>
