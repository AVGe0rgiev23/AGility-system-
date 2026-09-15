import { z } from 'zod'

export const SourceSchema = z.enum(['client-stated', 'measured', 'estimated', 'default'])
export type Source = z.infer<typeof SourceSchema>

// No BGN: Bulgaria adopted the euro on 1 January 2026, so Bulgarian companies are EUR companies.
export const CurrencySchema = z.enum(['EUR', 'GBP', 'USD'])
export type Currency = z.infer<typeof CurrencySchema>

// A unit is money when its leading segment is a currency code ('EUR', 'GBP/hour').
// Engines convert using `currency`, so it must be present and agree with the unit.
export function moneyUnitCurrency(unit: string): Currency | null {
  const parsed = CurrencySchema.safeParse(unit.split('/')[0])
  return parsed.success ? parsed.data : null
}

export const TracedValueSchema = z
  .object({
    // Every traced figure is a count, duration, share or cost. A negative one would run a
    // value or an effort calculation backwards without any warning.
    value: z.number().nonnegative(),
    unit: z.string(),
    currency: CurrencySchema.optional(),
    source: SourceSchema,
    note: z.string().optional(),
    capturedAt: z.string().optional(),
    answerId: z.string().optional(),
  })
  .superRefine((traced, ctx) => {
    const unitCurrency = moneyUnitCurrency(traced.unit)
    if (unitCurrency === null) return
    if (traced.currency === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['currency'],
        message: `currency is required for money unit '${traced.unit}'`,
      })
    } else if (traced.currency !== unitCurrency) {
      ctx.addIssue({
        code: 'custom',
        path: ['currency'],
        message: `currency '${traced.currency}' does not match unit '${traced.unit}'`,
      })
    }
  })
export type TracedValue = z.infer<typeof TracedValueSchema>
