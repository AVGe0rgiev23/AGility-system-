import { describe, expect, expectTypeOf, it } from 'vitest'
import { issuePaths, roundTrip, runCostLineItem, usageRunCostLineItem } from './__fixtures__/records'
import type { DeliveryModel } from './company'
import { RunCostLineItemSchema, type RunCostLineItem } from './run-cost'

describe('RunCostLineItemSchema', () => {
  it('accepts a fixed-cost item', () => {
    expect(RunCostLineItemSchema.parse(runCostLineItem())).toEqual(runCostLineItem())
  })

  it('accepts a usage-based item with its formula', () => {
    expect(RunCostLineItemSchema.parse(usageRunCostLineItem())).toEqual(usageRunCostLineItem())
  })

  it('requires usageFormula when the item is usage-based', () => {
    const { usageFormula: _omitted, ...withoutFormula } = usageRunCostLineItem()
    expect(issuePaths(RunCostLineItemSchema, withoutFormula)).toEqual(['usageFormula'])
  })

  it('requires a monthly cost only when the item is not usage-based', () => {
    expect(usageRunCostLineItem().monthlyCost).toBeNull()
    expect(issuePaths(RunCostLineItemSchema, { ...runCostLineItem(), monthlyCost: null })).toEqual(['monthlyCost'])
    expect(RunCostLineItemSchema.safeParse({ ...runCostLineItem(), monthlyCost: null }).error?.issues.map((issue) => issue.message)).toEqual([
      'monthlyCost is required when usageBased is false',
    ])
    expect(issuePaths(RunCostLineItemSchema, { ...runCostLineItem(), monthlyCost: 0 })).toEqual([])
  })

  it('still accepts a usage-based item carrying a monthly cost, as every v4 item does', () => {
    expect(issuePaths(RunCostLineItemSchema, { ...usageRunCostLineItem(), monthlyCost: 0 })).toEqual([])
  })

  it('refuses a missing monthly cost rather than reading it as null', () => {
    const { monthlyCost: _omitted, ...withoutCost } = usageRunCostLineItem()
    expect(issuePaths(RunCostLineItemSchema, withoutCost)).toEqual(['monthlyCost'])
  })

  it('requires a payer for every delivery model', () => {
    const paidBy = { 'fully-managed': 'agency', hybrid: 'client' }
    expect(issuePaths(RunCostLineItemSchema, { ...runCostLineItem(), paidBy })).toEqual([
      'paidBy.client-owned',
    ])
  })

  it('rejects an unknown payer or category', () => {
    const item = runCostLineItem()
    expect(
      issuePaths(RunCostLineItemSchema, { ...item, paidBy: { ...item.paidBy, hybrid: 'partner' } }),
    ).toEqual(['paidBy.hybrid'])
    expect(issuePaths(RunCostLineItemSchema, { ...item, category: 'cdn' })).toEqual(['category'])
  })

  it('survives a JSON round trip unchanged', () => {
    expect(RunCostLineItemSchema.parse(roundTrip(usageRunCostLineItem()))).toEqual(usageRunCostLineItem())
  })

  it('infers the spec types', () => {
    expectTypeOf<RunCostLineItem['monthlyCost']>().toEqualTypeOf<number | null>()
    expectTypeOf<RunCostLineItem['paidBy']>().toEqualTypeOf<
      Record<DeliveryModel, 'client' | 'agency' | 'not-applicable'>
    >()
    expectTypeOf<RunCostLineItem['usageFormula']>().toEqualTypeOf<
      | {
          callsPerMonth: number
          avgInputTokens: number
          avgOutputTokens: number
          inputPricePerMTok: number
          outputPricePerMTok: number
        }
      | undefined
    >()
  })
})
