import { describe, expect, it } from 'vitest'
import { runCostLineItem, usageRunCostLineItem } from '../schema/__fixtures__/records'
import type { DeliveryModel } from '../schema/company'
import { defaultConfig } from '../schema/config'
import type { RunCostLineItem } from '../schema/run-cost'
import { mulberry32, randomInt, randomRunCostItem, warningCodes } from './__fixtures__/engine-fixtures'
import { computeRunCost, itemMonthlyCost, RETAINER_MARGIN_THRESHOLD, type RunCostInput } from './run-cost'

const NOW = '2026-09-15T10:00:00.000Z'
const MODELS: DeliveryModel[] = ['fully-managed', 'client-owned', 'hybrid']

// The schema fixtures: €5/month hosting and a usage-based model at 3.24 + 2.025 = €5.265/month,
// both paid by the agency when fully managed and by the client otherwise.
function baseInput(overrides: Partial<RunCostInput> = {}): RunCostInput {
  return {
    items: [runCostLineItem(), usageRunCostLineItem()],
    deliveryModel: 'fully-managed',
    supportRetainerMonthly: null,
    config: defaultConfig(),
    now: NOW,
    ...overrides,
  }
}

function agencyItem(monthlyCost: number, id = 'rc-agency'): RunCostLineItem {
  return {
    ...runCostLineItem(),
    id,
    label: `Agency item ${id}`,
    monthlyCost,
    paidBy: { 'fully-managed': 'agency', 'client-owned': 'agency', hybrid: 'agency' },
  }
}

describe('run-cost constants', () => {
  it('match ENGINES §3', () => {
    expect(RETAINER_MARGIN_THRESHOLD).toBe(0.4)
  })
})

describe('itemMonthlyCost', () => {
  it('uses the fixed monthly cost for a fixed item', () => {
    expect(itemMonthlyCost(runCostLineItem())).toBe(5)
  })

  it('prices a usage-based item from its formula alone', () => {
    expect(itemMonthlyCost(usageRunCostLineItem())).toBeCloseTo(5.265, 10)
    expect(itemMonthlyCost({ ...usageRunCostLineItem(), monthlyCost: 999 })).toBeCloseTo(5.265, 10)
  })

  it('prices a usage-based item without a formula at 0', () => {
    const { usageFormula: _omitted, ...withoutFormula } = usageRunCostLineItem()
    expect(itemMonthlyCost(withoutFormula)).toBe(0)
  })
})

describe('computeRunCost per delivery model (§3)', () => {
  it('splits every item by who pays under each model', () => {
    const result = computeRunCost(baseInput())
    const managed = result.perModel['fully-managed']
    expect(managed.clientMonthly).toBe(0)
    expect(managed.agencyMonthly).toBeCloseTo(10.265, 10)
    expect(managed.agencyAnnual).toBeCloseTo(123.18, 10)
    for (const model of ['client-owned', 'hybrid'] as const) {
      expect(result.perModel[model].clientMonthly, model).toBeCloseTo(10.265, 10)
      expect(result.perModel[model].agencyMonthly, model).toBe(0)
      expect(result.perModel[model].agencyAnnual, model).toBe(0)
    }
    expect(managed.lineItems.map(({ label, paidBy }) => ({ label, paidBy }))).toEqual([
      { label: 'Worker hosting', paidBy: 'agency' },
      { label: 'Email classification model', paidBy: 'agency' },
    ])
    expect(managed.lineItems.map((item) => item.monthly)[0]).toBe(5)
    expect(managed.lineItems.map((item) => item.monthly)[1]).toBeCloseTo(5.265, 10)
    expect(result.perModel.hybrid.lineItems.map((item) => item.paidBy)).toEqual(['client', 'client'])
  })

  it('lists a not-applicable item without counting it', () => {
    const item: RunCostLineItem = {
      ...runCostLineItem(),
      paidBy: { 'fully-managed': 'not-applicable', 'client-owned': 'client', hybrid: 'not-applicable' },
    }
    const result = computeRunCost(baseInput({ items: [item] }))
    expect(result.perModel['fully-managed']).toMatchObject({ clientMonthly: 0, agencyMonthly: 0 })
    expect(result.perModel['fully-managed'].lineItems).toEqual([{ label: 'Worker hosting', monthly: 5, paidBy: 'not-applicable' }])
    expect(result.perModel['client-owned'].clientMonthly).toBe(5)
  })

  it('mirrors the selected model into the top-level figures', () => {
    for (const deliveryModel of MODELS) {
      const result = computeRunCost(baseInput({ deliveryModel }))
      expect(result.selectedModel).toBe(deliveryModel)
      expect(result.clientMonthly).toBe(result.perModel[deliveryModel].clientMonthly)
      expect(result.agencyMonthly).toBe(result.perModel[deliveryModel].agencyMonthly)
      expect(result.agencyAnnual).toBe(result.perModel[deliveryModel].agencyAnnual)
    }
  })

  it('returns zeros and no warnings for no items', () => {
    const result = computeRunCost(baseInput({ items: [] }))
    for (const deliveryModel of MODELS) {
      expect(result.perModel[deliveryModel]).toEqual({ clientMonthly: 0, agencyMonthly: 0, agencyAnnual: 0, lineItems: [] })
    }
    expect(result.warnings).toEqual([])
  })
})

describe('computeRunCost warnings (§3)', () => {
  it('warns when the client-owned column carries agency cost, whichever model is selected', () => {
    const items = [agencyItem(20)]
    for (const deliveryModel of MODELS) {
      const result = computeRunCost(baseInput({ items, deliveryModel, supportRetainerMonthly: 500 }))
      expect(warningCodes(result), deliveryModel).toContain('AGENCY_COST_UNDER_CLIENT_OWNED')
    }
    expect(warningCodes(computeRunCost(baseInput({ deliveryModel: 'client-owned' })))).not.toContain(
      'AGENCY_COST_UNDER_CLIENT_OWNED',
    )
  })

  it('warns RETAINER_MARGIN_THIN when agency cost exceeds 40% of the retainer, on the selected model', () => {
    // €350/month → €4,200/year; 40% is €1,680/year, or €140/month.
    const thin = computeRunCost(baseInput({ items: [agencyItem(150)], supportRetainerMonthly: 350 }))
    expect(warningCodes(thin)).toContain('RETAINER_MARGIN_THIN')
    const atThreshold = computeRunCost(baseInput({ items: [agencyItem(140)], supportRetainerMonthly: 350 }))
    expect(warningCodes(atThreshold)).not.toContain('RETAINER_MARGIN_THIN')
    const clientPays = computeRunCost(baseInput({ deliveryModel: 'hybrid', supportRetainerMonthly: 350, items: [runCostLineItem()] }))
    expect(warningCodes(clientPays)).not.toContain('RETAINER_MARGIN_THIN')
  })

  it('warns RETAINER_NOT_SET only when the agency carries cost and no retainer is set', () => {
    const unset = computeRunCost(baseInput())
    expect(warningCodes(unset)).toContain('RETAINER_NOT_SET')
    expect(warningCodes(unset)).not.toContain('RETAINER_MARGIN_THIN')
    const nothingToCarry = computeRunCost(baseInput({ deliveryModel: 'client-owned' }))
    expect(warningCodes(nothingToCarry)).not.toContain('RETAINER_NOT_SET')
    const set = computeRunCost(baseInput({ supportRetainerMonthly: 350 }))
    expect(warningCodes(set)).not.toContain('RETAINER_NOT_SET')
  })

  it('warns about a usage-based item with no formula', () => {
    const { usageFormula: _omitted, ...withoutFormula } = usageRunCostLineItem()
    const result = computeRunCost(baseInput({ items: [withoutFormula] }))
    expect(result.warnings.find((warning) => warning.code === 'MISSING_USAGE_FORMULA')?.message).toContain(
      'Email classification model',
    )
    expect(result.agencyMonthly).toBe(0)
  })
})

describe('computeRunCost output shape', () => {
  it('stamps computedAt from the clock and keeps it out of the hash', () => {
    const a = computeRunCost(baseInput())
    const b = computeRunCost(baseInput({ now: '2030-01-01T00:00:00.000Z' }))
    expect(b.computedAt).toBe('2030-01-01T00:00:00.000Z')
    expect(b.inputsHash).toBe(a.inputsHash)
  })

  it('changes the hash when an input changes', () => {
    const base = computeRunCost(baseInput()).inputsHash
    expect(computeRunCost(baseInput({ deliveryModel: 'hybrid' })).inputsHash).not.toBe(base)
    expect(computeRunCost(baseInput({ supportRetainerMonthly: 350 })).inputsHash).not.toBe(base)
    expect(computeRunCost(baseInput({ items: [runCostLineItem()] })).inputsHash).not.toBe(base)
    expect(computeRunCost(baseInput({ items: [{ ...runCostLineItem(), monthlyCost: 6 }, usageRunCostLineItem()] })).inputsHash).not.toBe(base)
  })

  it('keeps the hash stable when Config changes, which it does not read', () => {
    const base = computeRunCost(baseInput()).inputsHash
    const config = defaultConfig()
    config.pricing.targetHourlyRate = 90
    config.pricing.supportMonthly = { floor: 1, ceiling: 2 }
    config.storage.lastSyncAt = NOW
    expect(computeRunCost(baseInput({ config })).inputsHash).toBe(base)
  })

  it('does not mutate its inputs', () => {
    const input = baseInput({ supportRetainerMonthly: 350 })
    const copy = structuredClone(input)
    computeRunCost(input)
    expect(input).toEqual(copy)
  })
})

describe('computeRunCost invariants', () => {
  it('sums each column from the items that name that payer, and annualises by 12', () => {
    const random = mulberry32(51)
    for (let i = 0; i < 300; i++) {
      const items = Array.from({ length: randomInt(random, 0, 6) }, (_, index) => randomRunCostItem(random, index))
      const result = computeRunCost(baseInput({ items }))
      for (const model of MODELS) {
        const column = result.perModel[model]
        const expectedClient = items.filter((item) => item.paidBy[model] === 'client').reduce((sum, item) => sum + itemMonthlyCost(item), 0)
        const expectedAgency = items.filter((item) => item.paidBy[model] === 'agency').reduce((sum, item) => sum + itemMonthlyCost(item), 0)
        expect(column.clientMonthly, `case ${i} ${model}`).toBeCloseTo(expectedClient, 8)
        expect(column.agencyMonthly, `case ${i} ${model}`).toBeCloseTo(expectedAgency, 8)
        expect(column.agencyAnnual, `case ${i} ${model}`).toBeCloseTo(12 * column.agencyMonthly, 8)
        expect(column.lineItems.length, `case ${i} ${model}`).toBe(items.length)
      }
    }
  })
})
