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
    // EUR. Ignored when usageBased.
    monthlyCost: z.number(),
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
  })
export type RunCostLineItem = z.infer<typeof RunCostLineItemSchema>
