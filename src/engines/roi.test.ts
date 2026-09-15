import { describe, expect, it } from 'vitest'
import { estimateResult, opportunity, roiResult, runCostResult, scoringResult, tracedHours } from '../schema/__fixtures__/records'
import { defaultConfig } from '../schema/config'
import type { ROIResult } from '../schema/results'
import type { TracedValue } from '../schema/traced'
import { mulberry32, randomROIInput } from './__fixtures__/engine-fixtures'
import type { ScoredOpportunity } from './estimate'
import { computeROI, RUN_COST_SHARE_THRESHOLD, type ROIInput } from './roi'

const NOW = '2026-09-15T10:00:00.000Z'

// The schema fixtures: €18,240 gross at confidence 82, 33.6 hours saved a month, price
// €2,378.545, €5/month client run cost and nothing for the agency.
function scored(overrides: { id?: string; annualValue?: number; confidence?: number; assumptions?: TracedValue[] } = {}): ScoredOpportunity {
  return {
    opportunity: { ...opportunity(), id: overrides.id ?? 'opp-1' },
    scoring: {
      ...scoringResult(),
      annualValue: overrides.annualValue ?? 18240,
      confidence: overrides.confidence ?? 82,
      assumptions: overrides.assumptions ?? [tracedHours()],
    },
  }
}

function baseInput(overrides: Partial<ROIInput> = {}): ROIInput {
  return {
    scored: [scored()],
    estimate: estimateResult(),
    runCost: runCostResult(),
    config: defaultConfig(),
    now: NOW,
    ...overrides,
  }
}

function withRunCost(clientMonthly: number, agencyMonthly: number): ROIInput['runCost'] {
  return { ...runCostResult(), clientMonthly, agencyMonthly, agencyAnnual: agencyMonthly * 12 }
}

function expectScenario(actual: ROIResult['scenarios'][keyof ROIResult['scenarios']], expected: typeof actual): void {
  expect(actual.grossAnnualValue).toBeCloseTo(expected.grossAnnualValue, 6)
  expect(actual.netAnnualBenefit).toBeCloseTo(expected.netAnnualBenefit, 6)
  if (expected.paybackMonths === null) expect(actual.paybackMonths).toBeNull()
  else expect(actual.paybackMonths).toBeCloseTo(expected.paybackMonths, 6)
  expect(actual.roiYear1).toBeCloseTo(expected.roiYear1, 6)
  expect(actual.roiYear3).toBeCloseTo(expected.roiYear3, 6)
  expect(actual.npv).toBeCloseTo(expected.npv, 6)
}

function scenarioFor(gross: number, annualRunCost: number, cost: number, rate = 0.08, horizon = 3) {
  const net = gross - annualRunCost
  let npv = -cost
  for (let year = 1; year <= horizon; year++) npv += net / (1 + rate) ** year
  return {
    grossAnnualValue: gross,
    netAnnualBenefit: net,
    paybackMonths: net <= 0 ? null : cost / (net / 12),
    roiYear1: (net - cost) / cost,
    roiYear3: (3 * net - cost) / cost,
    npv,
  }
}

describe('roi constants', () => {
  it('match ENGINES §4', () => {
    expect(RUN_COST_SHARE_THRESHOLD).toBe(0.3)
  })
})

describe('computeROI (§4)', () => {
  it('computes the expected scenario from the schema fixture', () => {
    const result = computeROI(baseInput())
    const fixture = roiResult()
    expect(result.scenarios.expected.grossAnnualValue).toBe(18240)
    expect(result.scenarios.expected.netAnnualBenefit).toBe(18180)
    expect(result.scenarios.expected.paybackMonths).toBeCloseTo(fixture.scenarios.expected.paybackMonths ?? NaN, 2)
    expect(result.scenarios.expected.roiYear1).toBeCloseTo(fixture.scenarios.expected.roiYear1, 2)
    expect(result.scenarios.expected.roiYear3).toBeCloseTo(fixture.scenarios.expected.roiYear3, 2)
    expect(result.scenarios.expected.npv).toBeCloseTo(fixture.scenarios.expected.npv, 0)
    expect(result.hoursSavedPerMonth).toBeCloseTo(33.6, 10)
    expect(result.hoursSavedPerYear).toBeCloseTo(403.2, 10)
    expect(result.implementationCost).toBe(2378.545)
    expect(result.annualRunCost).toBe(60)
    expect(result.assumptions).toEqual([tracedHours()])
    expect(result.lowestConfidence).toBe(82)
    expect(result.warnings).toEqual([])
    expect(result.computedAt).toBe(NOW)
  })

  it('recomputes everything from the scaled gross value in each scenario', () => {
    const result = computeROI(baseInput())
    expect(Object.keys(result.scenarios)).toEqual(['conservative', 'expected', 'optimistic'])
    expectScenario(result.scenarios.conservative, scenarioFor(18240 * 0.6, 60, 2378.545))
    expectScenario(result.scenarios.expected, scenarioFor(18240, 60, 2378.545))
    expectScenario(result.scenarios.optimistic, scenarioFor(18240 * 1.25, 60, 2378.545))
  })

  it('reads the scenario factors from Config', () => {
    const config = defaultConfig()
    config.roi.conservativeFactor = 0.5
    config.roi.optimisticFactor = 2
    const result = computeROI(baseInput({ config }))
    expect(result.scenarios.conservative.grossAnnualValue).toBe(9120)
    expect(result.scenarios.optimistic.grossAnnualValue).toBe(36480)
  })

  it('sums the unweighted annual value over the selected set', () => {
    const a = scored({ id: 'a', annualValue: 1000 })
    a.scoring.weightedValue = 5000
    const b = scored({ id: 'b', annualValue: 250 })
    const result = computeROI(baseInput({ scored: [a, b] }))
    expect(result.scenarios.expected.grossAnnualValue).toBe(1250)
    expect(result.hoursSavedPerMonth).toBeCloseTo(67.2, 10)
  })

  it('counts both run-cost buckets as the client’s cost of ownership', () => {
    const result = computeROI(baseInput({ runCost: withRunCost(50, 20) }))
    expect(result.annualRunCost).toBe(20 * 12 + 50 * 12)
    expect(result.scenarios.expected.netAnnualBenefit).toBe(18240 - 840)
  })

  it('takes the implementation cost from the estimate price', () => {
    const result = computeROI(baseInput({ estimate: { ...estimateResult(), price: 4000, indicativePrice: 9999 } }))
    expect(result.implementationCost).toBe(4000)
    expect(result.scenarios.expected.roiYear1).toBeCloseTo((18180 - 4000) / 4000, 10)
  })

  it('discounts NPV over the configured horizon at the configured rate', () => {
    const oneYear = defaultConfig()
    oneYear.roi.horizonYears = 1
    expect(computeROI(baseInput({ config: oneYear })).scenarios.expected.npv).toBeCloseTo(-2378.545 + 18180 / 1.08, 8)
    const undiscounted = defaultConfig()
    undiscounted.roi.discountRate = 0
    undiscounted.roi.horizonYears = 5
    expect(computeROI(baseInput({ config: undiscounted })).scenarios.expected.npv).toBeCloseTo(-2378.545 + 5 * 18180, 8)
  })

  it('has no payback when the running cost meets or exceeds the value', () => {
    const exceeds = computeROI(baseInput({ runCost: withRunCost(2000, 0) }))
    expect(exceeds.scenarios.expected.paybackMonths).toBeNull()
    expect(exceeds.scenarios.expected.netAnnualBenefit).toBe(18240 - 24000)
    expect(exceeds.warnings).toContainEqual(expect.stringMatching(/^NO_PAYBACK: /))
    const equals = computeROI(baseInput({ runCost: withRunCost(1520, 0) }))
    expect(equals.scenarios.expected.paybackMonths).toBeNull()
  })

  it('returns 0 ROI with a warning when there is no implementation cost to divide by', () => {
    const result = computeROI(baseInput({ estimate: { ...estimateResult(), price: 0 } }))
    for (const scenario of Object.values(result.scenarios)) {
      expect(scenario.roiYear1).toBe(0)
      expect(scenario.roiYear3).toBe(0)
      expect(scenario.paybackMonths).toBe(0)
      expect(Number.isFinite(scenario.npv)).toBe(true)
    }
    expect(result.warnings).toContainEqual(expect.stringMatching(/^NO_IMPLEMENTATION_COST: /))
  })

  it('reports the empty scope rather than a low-confidence case', () => {
    const result = computeROI(baseInput({ scored: [] }))
    expect(result.scenarios.expected.grossAnnualValue).toBe(0)
    expect(result.lowestConfidence).toBe(0)
    expect(result.assumptions).toEqual([])
    expect(result.warnings).toContainEqual(expect.stringMatching(/^EMPTY_SCOPE: /))
    expect(result.warnings).not.toContainEqual(expect.stringMatching(/^LOW_CONFIDENCE: /))
  })

  it('lists each distinct assumption once across the selected set', () => {
    const shared = tracedHours()
    const other: TracedValue = { value: 9, unit: 'count', source: 'measured' }
    const a = scored({ id: 'a', assumptions: [shared, other] })
    const b = scored({ id: 'b', assumptions: [{ ...shared }] })
    expect(computeROI(baseInput({ scored: [a, b] })).assumptions).toEqual([shared, other])
  })
})

describe('computeROI warnings (§4)', () => {
  it('warns when the expected payback exceeds the configured months, not when it equals them', () => {
    // €2,378.545 over (net / 12): net of €1,189.2725 gives exactly 24 months.
    const config = defaultConfig()
    config.roi.paybackWarningMonths = 24
    const slow = computeROI(baseInput({ scored: [scored({ annualValue: 1200 })], config }))
    expect(slow.scenarios.expected.paybackMonths).toBeGreaterThan(24)
    expect(slow.warnings).toContainEqual(expect.stringMatching(/^PAYBACK_TOO_LONG: /))
    const exact = computeROI(baseInput({ scored: [scored({ annualValue: 1189.2725 + 60 })], config }))
    expect(exact.scenarios.expected.paybackMonths).toBeCloseTo(24, 8)
    expect(exact.warnings).not.toContainEqual(expect.stringMatching(/^PAYBACK_TOO_LONG: /))
  })

  it('warns when the lowest confidence is below 50', () => {
    const result = computeROI(baseInput({ scored: [scored({ id: 'a', confidence: 90 }), scored({ id: 'b', confidence: 49 })] }))
    expect(result.lowestConfidence).toBe(49)
    expect(result.warnings).toContainEqual(expect.stringMatching(/^LOW_CONFIDENCE: /))
    const edge = computeROI(baseInput({ scored: [scored({ confidence: 50 })] }))
    expect(edge.warnings).not.toContainEqual(expect.stringMatching(/^LOW_CONFIDENCE: /))
  })

  it('warns when the running cost exceeds 30% of the gross value, not at 30%', () => {
    // 30% of €18,240 is €5,472/year, or €456/month.
    const eats = computeROI(baseInput({ runCost: withRunCost(457, 0) }))
    expect(eats.warnings).toContainEqual(expect.stringMatching(/^RUN_COST_EATS_CASE: /))
    const edge = computeROI(baseInput({ runCost: withRunCost(456, 0) }))
    expect(edge.warnings).not.toContainEqual(expect.stringMatching(/^RUN_COST_EATS_CASE: /))
  })

  it('warns when any money figure among the assumptions is a default, telling money by its currency', () => {
    const hourly: TracedValue = { value: 20, unit: 'EUR/hour', currency: 'EUR', source: 'default' }
    const perError: TracedValue = { value: 40, unit: 'per error', currency: 'GBP', source: 'default' }
    for (const madeUp of [hourly, perError]) {
      const result = computeROI(baseInput({ scored: [scored({ assumptions: [tracedHours(), madeUp] })] }))
      expect(result.warnings, madeUp.unit).toContainEqual(expect.stringMatching(/^DEFAULT_COST: /))
    }
    const estimated: TracedValue = { ...hourly, source: 'estimated' }
    const fine = computeROI(baseInput({ scored: [scored({ assumptions: [estimated] })] }))
    expect(fine.warnings).not.toContainEqual(expect.stringMatching(/^DEFAULT_COST: /))
    // No currency means not money, whatever the unit says.
    const notMoney: TracedValue = { value: 80, unit: 'EUR-ish percent', source: 'default' }
    const result = computeROI(baseInput({ scored: [scored({ assumptions: [notMoney] })] }))
    expect(result.warnings).not.toContainEqual(expect.stringMatching(/^DEFAULT_COST: /))
  })
})

describe('computeROI output shape', () => {
  it('stamps computedAt from the clock and keeps it out of the hash', () => {
    const a = computeROI(baseInput())
    const b = computeROI(baseInput({ now: '2030-01-01T00:00:00.000Z' }))
    expect(b.computedAt).toBe('2030-01-01T00:00:00.000Z')
    expect(b.inputsHash).toBe(a.inputsHash)
  })

  it('changes the hash when an ROI input changes', () => {
    const base = computeROI(baseInput()).inputsHash
    expect(computeROI(baseInput({ scored: [scored({ annualValue: 18241 })] })).inputsHash).not.toBe(base)
    expect(computeROI(baseInput({ scored: [scored({ confidence: 40 })] })).inputsHash).not.toBe(base)
    expect(computeROI(baseInput({ estimate: { ...estimateResult(), price: 3000 } })).inputsHash).not.toBe(base)
    expect(computeROI(baseInput({ runCost: withRunCost(6, 0) })).inputsHash).not.toBe(base)
    const config = defaultConfig()
    config.roi.discountRate = 0.1
    expect(computeROI(baseInput({ config })).inputsHash).not.toBe(base)
  })

  it('keeps the hash stable when an unread field changes', () => {
    const base = computeROI(baseInput()).inputsHash
    const input = baseInput()
    const only = input.scored[0]
    if (only === undefined) throw new Error('baseInput has one scored opportunity')
    only.opportunity.title = 'Renamed'
    only.scoring.valueScore = 1
    only.scoring.weightedValue = 1
    only.scoring.computedAt = '2030-01-01T00:00:00.000Z'
    only.scoring.inputsHash = 'other'
    input.estimate.totalHours = 1
    input.estimate.indicativePrice = 1
    input.estimate.computedAt = '2030-01-01T00:00:00.000Z'
    input.runCost.computedAt = '2030-01-01T00:00:00.000Z'
    input.runCost.warnings = ['ignored']
    input.config.pricing.targetHourlyRate = 90
    input.config.storage.lastSyncAt = NOW
    expect(computeROI(input).inputsHash).toBe(base)
  })

  it('does not mutate its inputs', () => {
    const input = baseInput()
    const copy = structuredClone(input)
    computeROI(input)
    expect(input).toEqual(copy)
  })
})

describe('computeROI invariants', () => {
  const CASES = 300

  it('orders the scenarios conservative ≤ expected ≤ optimistic on every figure', () => {
    const random = mulberry32(61)
    for (let i = 0; i < CASES; i++) {
      const { conservative, expected, optimistic } = computeROI(randomROIInput(random)).scenarios
      for (const key of ['grossAnnualValue', 'netAnnualBenefit', 'roiYear1', 'roiYear3', 'npv'] as const) {
        expect(conservative[key], `case ${i} ${key}`).toBeLessThanOrEqual(expected[key] + 1e-9)
        expect(expected[key], `case ${i} ${key}`).toBeLessThanOrEqual(optimistic[key] + 1e-9)
      }
    }
  })

  it('has a payback exactly when the net benefit is positive', () => {
    const random = mulberry32(62)
    for (let i = 0; i < CASES; i++) {
      const result = computeROI(randomROIInput(random))
      for (const scenario of Object.values(result.scenarios)) {
        if (scenario.netAnnualBenefit <= 0) expect(scenario.paybackMonths, `case ${i}`).toBeNull()
        else {
          expect(scenario.paybackMonths, `case ${i}`).not.toBeNull()
          expect(scenario.paybackMonths ?? -1, `case ${i}`).toBeGreaterThanOrEqual(0)
        }
      }
    }
  })

  it('never produces a non-finite number', () => {
    const random = mulberry32(63)
    for (let i = 0; i < CASES; i++) {
      const result = computeROI(randomROIInput(random))
      for (const scenario of Object.values(result.scenarios)) {
        for (const value of Object.values(scenario)) {
          if (value !== null) expect(Number.isFinite(value), `case ${i}`).toBe(true)
        }
      }
      expect(Number.isFinite(result.annualRunCost), `case ${i}`).toBe(true)
      expect(result.hoursSavedPerYear, `case ${i}`).toBeCloseTo(12 * result.hoursSavedPerMonth, 8)
    }
  })

  it('scaling every money input by a constant scales NPV and leaves ROI and payback unchanged', () => {
    const random = mulberry32(64)
    for (let i = 0; i < CASES; i++) {
      const input = randomROIInput(random)
      const scaled = structuredClone(input)
      for (const entry of scaled.scored) entry.scoring.annualValue *= 2
      scaled.estimate.price *= 2
      scaled.runCost.clientMonthly *= 2
      scaled.runCost.agencyAnnual *= 2
      const base = computeROI(input).scenarios
      const twice = computeROI(scaled).scenarios
      for (const key of ['conservative', 'expected', 'optimistic'] as const) {
        expect(twice[key].npv, `case ${i} ${key}`).toBeCloseTo(2 * base[key].npv, 6)
        expect(twice[key].roiYear1, `case ${i} ${key}`).toBeCloseTo(base[key].roiYear1, 6)
        expect(twice[key].roiYear3, `case ${i} ${key}`).toBeCloseTo(base[key].roiYear3, 6)
        if (base[key].paybackMonths === null) expect(twice[key].paybackMonths, `case ${i} ${key}`).toBeNull()
        else expect(twice[key].paybackMonths, `case ${i} ${key}`).toBeCloseTo(base[key].paybackMonths, 6)
      }
    }
  })

  it('the same inputs always produce the same inputsHash', () => {
    const random = mulberry32(65)
    for (let i = 0; i < CASES; i++) {
      const input = randomROIInput(random)
      const hash = computeROI(input).inputsHash
      expect(computeROI(structuredClone(input)).inputsHash, `case ${i}`).toBe(hash)
      expect(computeROI({ ...input, now: '1999-12-31T23:59:59.000Z' }).inputsHash, `case ${i}`).toBe(hash)
    }
  })
})
