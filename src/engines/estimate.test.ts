import { describe, expect, it } from 'vitest'
import { estimateResult, opportunity, scoringResult } from '../schema/__fixtures__/records'
import { defaultConfig, type Config } from '../schema/config'
import type { EstimateFlag } from '../schema/results'
import {
  mulberry32,
  randomCalibration,
  randomInt,
  randomNumber,
  randomScored,
  randomScoredSet,
} from './__fixtures__/engine-fixtures'
import type { CalibrationLookup } from './calibration'
import { estimateScope, type EstimateInput, type ScoredOpportunity } from './estimate'

const NOW = '2026-09-15T10:00:00.000Z'

// The schema fixture: 21.5 raw hours at confidence 82, primary pattern 'pat-email-triage'.
function scored(overrides: { id?: string; rawBuildHours?: number; confidence?: number; primaryPatternId?: string | null } = {}): ScoredOpportunity {
  return {
    opportunity: {
      ...opportunity(),
      id: overrides.id ?? 'opp-1',
      primaryPatternId: overrides.primaryPatternId === undefined ? 'pat-email-triage' : overrides.primaryPatternId,
    },
    scoring: {
      ...scoringResult(),
      rawBuildHours: overrides.rawBuildHours ?? 21.5,
      confidence: overrides.confidence ?? 82,
    },
  }
}

function baseInput(overrides: Partial<EstimateInput> = {}): EstimateInput {
  return {
    scored: [scored()],
    config: defaultConfig(),
    calibration: {},
    advisoryBlueprintHours: null,
    now: NOW,
    ...overrides,
  }
}

// Overheads and contingency off, so totalHours equals the raw hours exactly.
function flatConfig(): Config {
  const config = defaultConfig()
  config.estimation.overheads = { discovery: 0, testing: 0, documentation: 0, deployment: 0 }
  config.estimation.contingency = 0
  return config
}

const calibrated: CalibrationLookup = {
  'pat-email-triage': { multiplier: 1.4, sampleCount: 5, trustworthy: true },
}

describe('estimateScope hours (§2)', () => {
  it('computes the worked example from the schema fixture', () => {
    const result = estimateScope(baseInput())
    const expected = estimateResult()
    expect(result.calibratedHours).toBeCloseTo(expected.calibratedHours, 10)
    expect(result.overheadBreakdown.map((entry) => entry.label)).toEqual(['discovery', 'testing', 'documentation', 'deployment'])
    for (const [index, entry] of result.overheadBreakdown.entries()) {
      expect(entry.hours, entry.label).toBeCloseTo(expected.overheadBreakdown[index]?.hours ?? NaN, 10)
    }
    expect(result.contingencyHours).toBeCloseTo(expected.contingencyHours, 10)
    expect(result.totalHours).toBeCloseTo(expected.totalHours, 10)
    expect(result.bandId).toBe('full-workflow')
    expect(result.indicativePrice).toBeCloseTo(expected.indicativePrice, 8)
    expect(result.price).toBeCloseTo(expected.price, 8)
    expect(result.effectiveHourlyRate).toBeCloseTo(65, 10)
    expect(result.flags).toEqual(['UNCALIBRATED_PATTERN'])
    expect(result.perOpportunity).toEqual(expected.perOpportunity)
    expect(result.advisoryBlueprintHours).toBeNull()
    expect(result.computedAt).toBe(NOW)
  })

  it('applies the primary pattern multiplier here and nowhere else', () => {
    const result = estimateScope(baseInput({ calibration: calibrated }))
    expect(result.calibratedHours).toBeCloseTo(21.5 * 1.4, 10)
    expect(result.perOpportunity).toEqual([
      { opportunityId: 'opp-1', rawHours: 21.5, multiplier: 1.4, trustworthy: true, calibratedHours: 21.5 * 1.4 },
    ])
    expect(result.flags).not.toContain('UNCALIBRATED_PATTERN')
  })

  it('ignores calibration for patterns that are linked but not primary', () => {
    const calibration: CalibrationLookup = { 'pat-crm-sync': { multiplier: 3, sampleCount: 9, trustworthy: true } }
    const result = estimateScope(baseInput({ calibration }))
    expect(result.calibratedHours).toBeCloseTo(21.5, 10)
    expect(result.flags).toContain('UNCALIBRATED_PATTERN')
  })

  it('treats a missing primary pattern as an uncalibrated multiplier of 1', () => {
    const result = estimateScope(baseInput({ scored: [scored({ primaryPatternId: null })], calibration: calibrated }))
    expect(result.perOpportunity[0]).toMatchObject({ multiplier: 1, trustworthy: false, calibratedHours: 21.5 })
    expect(result.flags).toContain('UNCALIBRATED_PATTERN')
  })

  it('does not read inherited keys off a plain-object lookup', () => {
    const result = estimateScope(baseInput({ scored: [scored({ primaryPatternId: 'constructor' })] }))
    expect(result.perOpportunity[0]).toMatchObject({ multiplier: 1, trustworthy: false })
  })

  it('adds overheads on calibrated hours and contingency after', () => {
    const config = defaultConfig()
    config.estimation.overheads = { discovery: 0.1, testing: 0.2, documentation: 0.1, deployment: 0.1 }
    config.estimation.contingency = 0.25
    const result = estimateScope(baseInput({ scored: [scored({ rawBuildHours: 100 })], config }))
    expect(result.overheadBreakdown).toEqual([
      { label: 'discovery', hours: 10 },
      { label: 'testing', hours: 20 },
      { label: 'documentation', hours: 10 },
      { label: 'deployment', hours: 10 },
    ])
    expect(result.contingencyHours).toBeCloseTo(150 * 0.25, 10)
    expect(result.totalHours).toBeCloseTo(150 * 1.25, 10)
  })

  it('sums every selected opportunity', () => {
    const result = estimateScope(
      baseInput({
        scored: [scored({ id: 'a', rawBuildHours: 10 }), scored({ id: 'b', rawBuildHours: 20, primaryPatternId: null })],
        calibration: calibrated,
      }),
    )
    expect(result.calibratedHours).toBeCloseTo(10 * 1.4 + 20, 10)
    expect(result.perOpportunity.map((entry) => entry.opportunityId)).toEqual(['a', 'b'])
  })
})

describe('estimateScope band placement and price (§2)', () => {
  it('places the pilot band and prices at the indicative rate inside it', () => {
    const result = estimateScope(baseInput({ scored: [scored({ rawBuildHours: 12 })], config: flatConfig() }))
    expect(result.bandId).toBe('pilot')
    expect(result.indicativePrice).toBeCloseTo(12 * 65, 10)
    expect(result.price).toBeCloseTo(780, 10)
    expect(result.effectiveHourlyRate).toBeCloseTo(65, 10)
    expect(result.flags).toEqual(['UNCALIBRATED_PATTERN'])
  })

  it('takes a band whose max hours equal the total, and the next band just above it', () => {
    const at = estimateScope(baseInput({ scored: [scored({ rawBuildHours: 15 })], config: flatConfig() }))
    expect(at.bandId).toBe('pilot')
    const above = estimateScope(baseInput({ scored: [scored({ rawBuildHours: 15.001 })], config: flatConfig() }))
    expect(above.bandId).toBe('full-workflow')
    const top = estimateScope(baseInput({ scored: [scored({ rawBuildHours: 60 })], config: flatConfig() }))
    expect(top.bandId).toBe('full-workflow')
    const custom = estimateScope(baseInput({ scored: [scored({ rawBuildHours: 60.001 })], config: flatConfig() }))
    expect(custom.bandId).toBe('custom')
  })

  it('lifts a price below the floor to the floor and flags BELOW_FLOOR', () => {
    const result = estimateScope(baseInput({ scored: [scored({ rawBuildHours: 8 })], config: flatConfig() }))
    expect(result.indicativePrice).toBeCloseTo(520, 10)
    expect(result.price).toBe(600)
    expect(result.effectiveHourlyRate).toBeCloseTo(600 / 8, 10)
    expect(result.flags).toEqual(['BELOW_FLOOR', 'UNCALIBRATED_PATTERN'])
  })

  it('caps a price above the ceiling at the ceiling and flags UNDERPRICED', () => {
    const result = estimateScope(baseInput({ scored: [scored({ rawBuildHours: 14 })], config: flatConfig() }))
    expect(result.bandId).toBe('pilot')
    expect(result.indicativePrice).toBeCloseTo(910, 10)
    expect(result.price).toBe(900)
    expect(result.effectiveHourlyRate).toBeCloseTo(900 / 14, 10)
    expect(result.flags).toEqual(['UNDERPRICED', 'UNCALIBRATED_PATTERN'])
  })

  it('leaves a custom quote unclamped and raises only CUSTOM_QUOTE among the band flags', () => {
    const result = estimateScope(baseInput({ scored: [scored({ rawBuildHours: 100 })], config: flatConfig(), calibration: calibrated }))
    expect(result.bandId).toBe('custom')
    expect(result.indicativePrice).toBeCloseTo(100 * 1.4 * 65, 8)
    expect(result.price).toBe(result.indicativePrice)
    expect(result.effectiveHourlyRate).toBeCloseTo(65, 10)
    expect(result.flags).toEqual(['CUSTOM_QUOTE'])
  })

  it('reads the target hourly rate from Config', () => {
    const config = flatConfig()
    config.pricing.targetHourlyRate = 80
    const result = estimateScope(baseInput({ scored: [scored({ rawBuildHours: 10 })], config }))
    expect(result.indicativePrice).toBe(800)
    expect(result.price).toBe(800)
  })

  it('refuses a Config with no unbounded band, which the schema never produces', () => {
    const config = flatConfig()
    config.pricing.bands = config.pricing.bands.filter((band) => band.maxHours !== null)
    expect(() => estimateScope(baseInput({ scored: [scored({ rawBuildHours: 100 })], config }))).toThrow(/unbounded/)
  })
})

describe('estimateScope empty scope (§2)', () => {
  it('places no band and prices nothing when no opportunity is selected', () => {
    const result = estimateScope(baseInput({ scored: [] }))
    expect(result).toMatchObject({
      calibratedHours: 0,
      contingencyHours: 0,
      totalHours: 0,
      bandId: null,
      indicativePrice: 0,
      price: 0,
      effectiveHourlyRate: null,
      flags: ['EMPTY_SCOPE'],
      perOpportunity: [],
    })
    expect(result.overheadBreakdown.map((entry) => entry.hours)).toEqual([0, 0, 0, 0])
  })

  it('still reports low confidence and uncalibrated patterns on a zero-hour scope', () => {
    const result = estimateScope(baseInput({ scored: [scored({ rawBuildHours: 0, confidence: 30 })] }))
    expect(result.flags).toEqual(['EMPTY_SCOPE', 'LOW_CONFIDENCE', 'UNCALIBRATED_PATTERN'])
    expect(result.price).toBe(0)
    expect(result.bandId).toBeNull()
  })
})

describe('estimateScope flags (§2)', () => {
  it('flags LOW_CONFIDENCE when any selected opportunity is below 50, not at 50', () => {
    const low = estimateScope(baseInput({ scored: [scored({ id: 'a', confidence: 90 }), scored({ id: 'b', confidence: 49 })] }))
    expect(low.flags).toContain('LOW_CONFIDENCE')
    const edge = estimateScope(baseInput({ scored: [scored({ confidence: 50 })] }))
    expect(edge.flags).not.toContain('LOW_CONFIDENCE')
  })

  it('flags UNCALIBRATED_PATTERN when any used pattern is untrustworthy', () => {
    const calibration: CalibrationLookup = {
      ...calibrated,
      'pat-crm-sync': { multiplier: 1, sampleCount: 2, trustworthy: false },
    }
    const mixed = estimateScope(
      baseInput({ scored: [scored({ id: 'a' }), scored({ id: 'b', primaryPatternId: 'pat-crm-sync' })], calibration }),
    )
    expect(mixed.flags).toContain('UNCALIBRATED_PATTERN')
    const trusted = estimateScope(baseInput({ calibration }))
    expect(trusted.flags).not.toContain('UNCALIBRATED_PATTERN')
  })

  it('lists flags in a fixed order: band flag, confidence, calibration', () => {
    const result = estimateScope(baseInput({ scored: [scored({ rawBuildHours: 8, confidence: 20 })], config: flatConfig() }))
    const expected: EstimateFlag[] = ['BELOW_FLOOR', 'LOW_CONFIDENCE', 'UNCALIBRATED_PATTERN']
    expect(result.flags).toEqual(expected)
  })
})

describe('estimateScope output shape', () => {
  it('copies the advisory blueprint hours through without letting them touch the price', () => {
    const plain = estimateScope(baseInput())
    const advised = estimateScope(baseInput({ advisoryBlueprintHours: 1000 }))
    expect(advised.advisoryBlueprintHours).toBe(1000)
    expect(advised.totalHours).toBe(plain.totalHours)
    expect(advised.price).toBe(plain.price)
    expect(advised.bandId).toBe(plain.bandId)
  })

  it('stamps computedAt from the clock and keeps it out of the hash', () => {
    const a = estimateScope(baseInput())
    const b = estimateScope(baseInput({ now: '2030-01-01T00:00:00.000Z' }))
    expect(b.computedAt).toBe('2030-01-01T00:00:00.000Z')
    expect(b.inputsHash).toBe(a.inputsHash)
  })

  it('changes the hash when an estimate input changes', () => {
    const base = estimateScope(baseInput()).inputsHash
    expect(estimateScope(baseInput({ scored: [scored({ rawBuildHours: 22 })] })).inputsHash).not.toBe(base)
    expect(estimateScope(baseInput({ scored: [scored({ confidence: 40 })] })).inputsHash).not.toBe(base)
    expect(estimateScope(baseInput({ calibration: calibrated })).inputsHash).not.toBe(base)
    expect(estimateScope(baseInput({ advisoryBlueprintHours: 30 })).inputsHash).not.toBe(base)
    const rate = defaultConfig()
    rate.pricing.targetHourlyRate = 70
    expect(estimateScope(baseInput({ config: rate })).inputsHash).not.toBe(base)
    const band = defaultConfig()
    band.pricing.bands[1] = { ...defaultConfig().pricing.bands[1], id: 'full-workflow', name: 'Full workflow', maxHours: 60, floor: 2000, ceiling: 4500 }
    expect(estimateScope(baseInput({ config: band })).inputsHash).not.toBe(base)
    const contingency = defaultConfig()
    contingency.estimation.contingency = 0.2
    expect(estimateScope(baseInput({ config: contingency })).inputsHash).not.toBe(base)
  })

  it('keeps the hash stable when an unread field changes', () => {
    const base = estimateScope(baseInput()).inputsHash
    const input = baseInput()
    const only = input.scored[0]
    if (only === undefined) throw new Error('baseInput has one scored opportunity')
    only.opportunity.title = 'Renamed'
    only.opportunity.selected = false
    only.scoring.annualValue = 1
    only.scoring.computedAt = '2030-01-01T00:00:00.000Z'
    only.scoring.inputsHash = 'other'
    input.calibration = { 'pat-unused': { multiplier: 2, sampleCount: 5, trustworthy: true } }
    input.config.pricing.supportMonthly = { floor: 1, ceiling: 2 }
    input.config.estimation.fallbackPatternHours = 99
    input.config.scoring.valueCeiling = 1
    input.config.storage.lastSyncAt = NOW
    expect(estimateScope(input).inputsHash).toBe(base)
  })

  it('does not mutate its inputs', () => {
    const input = baseInput({ calibration: calibrated, advisoryBlueprintHours: 12 })
    const copy = structuredClone(input)
    estimateScope(input)
    expect(input).toEqual(copy)
  })
})

describe('estimateScope invariants', () => {
  const CASES = 300

  function randomInput(random: () => number): EstimateInput {
    return { scored: randomScoredSet(random), config: defaultConfig(), calibration: randomCalibration(random), advisoryBlueprintHours: null, now: NOW }
  }

  it('totalHours is never below calibratedHours', () => {
    const random = mulberry32(41)
    for (let i = 0; i < CASES; i++) {
      const result = estimateScope(randomInput(random))
      expect(result.totalHours, `case ${i}`).toBeGreaterThanOrEqual(result.calibratedHours)
    }
  })

  it('a multiplier of 1.0 for every pattern gives totalHours = rawHours × 1.702', () => {
    const random = mulberry32(42)
    for (let i = 0; i < CASES; i++) {
      const input = randomInput(random)
      input.calibration = {}
      const rawHours = input.scored.reduce((sum, entry) => sum + entry.scoring.rawBuildHours, 0)
      expect(estimateScope(input).totalHours, `case ${i}`).toBeCloseTo(rawHours * 1.702, 8)
    }
  })

  it('doubling every rawBuildHours doubles totalHours', () => {
    const random = mulberry32(43)
    for (let i = 0; i < CASES; i++) {
      const input = randomInput(random)
      const doubled = structuredClone(input)
      for (const entry of doubled.scored) entry.scoring.rawBuildHours *= 2
      expect(estimateScope(doubled).totalHours, `case ${i}`).toBeCloseTo(2 * estimateScope(input).totalHours, 8)
    }
  })

  it('price stays within the band floor and ceiling when both are set', () => {
    const random = mulberry32(44)
    for (let i = 0; i < CASES; i++) {
      const input = randomInput(random)
      const result = estimateScope(input)
      const band = input.config.pricing.bands.find((candidate) => candidate.id === result.bandId)
      if (band === undefined || band.floor === null || band.ceiling === null) continue
      expect(result.price, `case ${i}`).toBeGreaterThanOrEqual(band.floor)
      expect(result.price, `case ${i}`).toBeLessThanOrEqual(band.ceiling)
      expect(result.flags.includes('UNDERPRICED'), `case ${i}`).toBe(result.indicativePrice > band.ceiling)
      expect(result.flags.includes('BELOW_FLOOR'), `case ${i}`).toBe(result.indicativePrice < band.floor)
    }
  })

  it('a zero-hour scope always prices at 0 with no band, no rate and EMPTY_SCOPE', () => {
    const random = mulberry32(45)
    for (let i = 0; i < CASES; i++) {
      const input = randomInput(random)
      if (random() < 0.5) input.scored = []
      else for (const entry of input.scored) entry.scoring.rawBuildHours = 0
      const result = estimateScope(input)
      expect(result.totalHours, `case ${i}`).toBe(0)
      expect(result, `case ${i}`).toMatchObject({ price: 0, indicativePrice: 0, bandId: null, effectiveHourlyRate: null })
      expect(result.flags[0], `case ${i}`).toBe('EMPTY_SCOPE')
      expect(result.flags.filter((flag) => ['UNDERPRICED', 'BELOW_FLOOR', 'CUSTOM_QUOTE'].includes(flag)), `case ${i}`).toEqual([])
    }
  })

  it('the effective hourly rate is price over total hours whenever hours exist', () => {
    const random = mulberry32(46)
    for (let i = 0; i < CASES; i++) {
      const result = estimateScope(randomInput(random))
      if (result.totalHours === 0) continue
      expect(result.effectiveHourlyRate, `case ${i}`).toBeCloseTo(result.price / result.totalHours, 10)
    }
  })

  it('the same inputs always produce the same inputsHash', () => {
    const random = mulberry32(47)
    for (let i = 0; i < CASES; i++) {
      const input = randomInput(random)
      input.advisoryBlueprintHours = random() < 0.5 ? null : randomNumber(random, 0, 100)
      const hash = estimateScope(input).inputsHash
      expect(estimateScope(structuredClone(input)).inputsHash, `case ${i}`).toBe(hash)
      expect(estimateScope({ ...input, now: '1999-12-31T23:59:59.000Z' }).inputsHash, `case ${i}`).toBe(hash)
      const extra = { ...input, scored: [...input.scored, randomScored(random, randomInt(random, 10, 20))] }
      expect(estimateScope(extra).inputsHash, `case ${i}`).not.toBe(hash)
    }
  })
})
