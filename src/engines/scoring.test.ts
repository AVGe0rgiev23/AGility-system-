import { describe, expect, it } from 'vitest'
import { businessProcess, company, opportunity } from '../schema/__fixtures__/records'
import { defaultConfig } from '../schema/config'
import type { Process } from '../schema/process'
import type { ScoringResult } from '../schema/results'
import type { Source, TracedValue } from '../schema/traced'
import { mulberry32, pick, randomInt, randomNumber, randomScoringInput, warningCodes } from './__fixtures__/engine-fixtures'
import { buildCalibrationLookup } from './calibration'
import {
  CONFIDENCE_MAX,
  CONFIDENCE_MIN,
  CONFIDENCE_PENALTIES,
  EFFORT_POINTS,
  LOW_CONFIDENCE_THRESHOLD,
  QUADRANT_THRESHOLD,
  scoreOpportunity,
  toAgencyCurrency,
  type ScoringInput,
} from './scoring'
import scoringSource from './scoring?raw'

const NOW = '2026-09-15T10:00:00.000Z'

// The schema fixtures: 120 × 12 min × 2 people, 70% automatable, €16/h blended (estimated),
// 5% errors at €40 with 80% reduction (default), direct impact, two patterns at 12 + 9 hours.
function baseInput(): ScoringInput {
  return {
    opportunity: opportunity(),
    processes: [businessProcess()],
    patterns: [
      { id: 'pat-email-triage', baseHours: 12 },
      { id: 'pat-crm-sync', baseHours: 9 },
    ],
    company: company(),
    config: defaultConfig(),
    now: NOW,
  }
}

function row(result: ScoringResult, label: string): ScoringResult['breakdown'][number] {
  const found = result.breakdown.find((entry) => entry.label === label)
  if (found === undefined) throw new Error(`no breakdown row labelled '${label}'`)
  return found
}

// Values are compared to 10 places: the working is arithmetic on binary floats.
function expectRow(
  result: ScoringResult,
  label: string,
  expected: Partial<ScoringResult['breakdown'][number]> & { value: number },
): void {
  const { value, ...rest } = expected
  const found = row(result, label)
  expect(found.value, label).toBeCloseTo(value, 10)
  expect(found, label).toMatchObject(rest)
}

function withSource(input: ScoringInput, source: Source): ScoringInput {
  const retag = (traced: TracedValue | null): TracedValue | null => (traced === null ? null : { ...traced, source })
  const process = input.processes[0]
  if (process === undefined) throw new Error('baseInput has one process')
  return {
    ...input,
    processes: [
      {
        ...process,
        frequency: {
          occurrencesPerMonth: { ...process.frequency.occurrencesPerMonth, source },
          minutesPerOccurrence: { ...process.frequency.minutesPerOccurrence, source },
          peopleInvolved: { ...process.frequency.peopleInvolved, source },
        },
        roleHourlyCost: retag(process.roleHourlyCost),
        errorProfile: {
          ...process.errorProfile,
          errorRatePercent: retag(process.errorProfile.errorRatePercent),
          costPerError: retag(process.errorProfile.costPerError),
        },
      },
    ],
    company: { ...input.company, blendedHourlyCost: retag(input.company.blendedHourlyCost) },
    opportunity: {
      ...input.opportunity,
      automatablePercent: { ...input.opportunity.automatablePercent, source },
      errorReductionPercent: { ...input.opportunity.errorReductionPercent, source },
    },
  }
}

describe('scoring constants', () => {
  it('match the ENGINES §1.2 effort table', () => {
    expect(EFFORT_POINTS).toEqual({
      integration: 2,
      integrationWithoutPublicApi: 4,
      integrationWithoutAuth: 3,
      dataReadiness: { structured: 0, 'semi-structured': 2, unstructured: 5 },
      approvalStep: 1.5,
      complianceFlag: 3,
      volumeTier: { low: 0, medium: 1, high: 3 },
      novelty: { 'known-pattern': 0, 'similar-pattern': 2, new: 5 },
      humanInLoop: 2,
    })
  })

  it('match the ENGINES §1.3 confidence penalties and clamp', () => {
    expect(CONFIDENCE_PENALTIES).toEqual({
      defaultSource: 12,
      estimatedSource: 6,
      noPattern: 15,
      hourlyCostNotClientStated: 10,
    })
    expect(CONFIDENCE_MIN).toBe(15)
    expect(CONFIDENCE_MAX).toBe(100)
    expect(LOW_CONFIDENCE_THRESHOLD).toBe(50)
    expect(QUADRANT_THRESHOLD).toBe(50)
  })
})

describe('toAgencyCurrency', () => {
  const config = defaultConfig()

  it('returns an agency-currency value unchanged', () => {
    expect(toAgencyCurrency({ value: 40, unit: 'EUR', currency: 'EUR', source: 'measured' }, config)).toBe(40)
  })

  it('divides by the units-per-EUR rate for another currency', () => {
    expect(toAgencyCurrency({ value: 85, unit: 'GBP/hour', currency: 'GBP', source: 'measured' }, config)).toBeCloseTo(100, 10)
    expect(toAgencyCurrency({ value: 108, unit: 'USD', currency: 'USD', source: 'measured' }, config)).toBeCloseTo(100, 10)
  })

  it('treats a value without a currency as already in the agency currency', () => {
    expect(toAgencyCurrency({ value: 7, unit: 'count', source: 'measured' }, config)).toBe(7)
  })
})

describe('scoreOpportunity value (§1.1)', () => {
  it('computes the worked example', () => {
    const result = scoreOpportunity(baseInput())
    expect(result.hoursSavedPerMonth).toBeCloseTo(33.6, 10)
    // 33.6 × 12 × 16 = 6451.2 labour, 120 × 12 × 5% × 40 × 80% = 2304 errors
    expect(result.annualValue).toBeCloseTo(8755.2, 10)
    expect(result.weightedValue).toBeCloseTo(10944, 10)
    expect(result.valueScore).toBe(36)
  })

  it('prefers the process role rate over the company blended rate', () => {
    const input = baseInput()
    const process = businessProcess()
    process.roleHourlyCost = { value: 32, unit: 'EUR/hour', currency: 'EUR', source: 'client-stated' }
    input.processes = [process]
    const result = scoreOpportunity(input)
    expect(result.annualValue).toBeCloseTo(33.6 * 12 * 32 + 2304, 10)
    expect(row(result, 'Quote request to CRM entry: effective hourly cost').value).toBe(32)
  })

  it('converts a foreign-currency hourly cost and cost per error to EUR', () => {
    const input = baseInput()
    const process = businessProcess()
    process.roleHourlyCost = { value: 17, unit: 'GBP/hour', currency: 'GBP', source: 'client-stated' }
    process.errorProfile.costPerError = { value: 54, unit: 'USD', currency: 'USD', source: 'estimated' }
    input.processes = [process]
    const result = scoreOpportunity(input)
    expect(result.annualValue).toBeCloseTo(33.6 * 12 * (17 / 0.85) + 1440 * 0.05 * (54 / 1.08) * 0.8, 8)
    expect(row(result, 'Quote request to CRM entry: effective hourly cost').unit).toBe('EUR/hour')
    expect(row(result, 'Quote request to CRM entry: effective hourly cost').formula).toContain('GBP')
  })

  it('counts error value only when both error inputs exist', () => {
    const input = baseInput()
    const process = businessProcess()
    process.errorProfile.costPerError = null
    input.processes = [process]
    const result = scoreOpportunity(input)
    expect(result.annualValue).toBeCloseTo(6451.2, 10)
    expect(result.breakdown.some((entry) => entry.label.endsWith('annual error value'))).toBe(false)
    // The error reduction feeds nothing, so it is not an assumption and cannot cost confidence.
    expect(result.assumptions).not.toContainEqual(input.opportunity.errorReductionPercent)
    expect(result.assumptions).not.toContainEqual(process.errorProfile.errorRatePercent)
  })

  it('values labour at 0 with a warning when no hourly cost exists anywhere', () => {
    const input = baseInput()
    input.company.blendedHourlyCost = null
    const result = scoreOpportunity(input)
    expect(result.annualValue).toBeCloseTo(2304, 10)
    expect(result.hoursSavedPerMonth).toBeCloseTo(33.6, 10)
    expect(warningCodes(result)).toContain('NO_HOURLY_COST')
    expect(row(result, 'Quote request to CRM entry: effective hourly cost')).toMatchObject({ value: 0, source: 'default' })
  })

  it('warns when an hourly cost carries no currency, and reads money from the currency, never the unit', () => {
    const noCurrency = baseInput()
    noCurrency.company.blendedHourlyCost = { value: 16, unit: 'rate', source: 'estimated' }
    expect(warningCodes(scoreOpportunity(noCurrency))).toContain('NON_HOURLY_COST_UNIT')
    // The unit is display text: a currency-carrying cost in any unit is money and converts.
    const oddUnit = baseInput()
    oddUnit.company.blendedHourlyCost = { value: 17, unit: 'per person-hour', currency: 'GBP', source: 'estimated' }
    const result = scoreOpportunity(oddUnit)
    expect(warningCodes(result)).not.toContain('NON_HOURLY_COST_UNIT')
    expect(row(result, 'Quote request to CRM entry: effective hourly cost').value).toBeCloseTo(20, 10)
    expect(warningCodes(scoreOpportunity(baseInput()))).not.toContain('NON_HOURLY_COST_UNIT')
  })

  it('weights by the highest revenue impact across linked processes, for ranking only', () => {
    const input = baseInput()
    const indirect: Process = { ...businessProcess(), id: 'proc-2', name: 'Second', revenueImpact: 'indirect' }
    const none: Process = { ...businessProcess(), id: 'proc-3', name: 'Third', revenueImpact: 'none' }
    input.processes = [indirect, none]
    input.opportunity.processIds = ['proc-2', 'proc-3']
    const result = scoreOpportunity(input)
    expect(result.annualValue).toBeCloseTo(2 * 8755.2, 10)
    expect(result.weightedValue).toBeCloseTo(2 * 8755.2 * 1.05, 10)
    expect(row(result, 'Strategic multiplier')).toMatchObject({ value: 1.05, source: 'default' })
    expect(result.breakdown.some((entry) => /weighted/i.test(entry.label))).toBe(false)
  })

  it('caps the value score at 100', () => {
    const input = baseInput()
    input.config.scoring.valueCeiling = 1000
    expect(scoreOpportunity(input).valueScore).toBe(100)
  })

  it('scores an opportunity with no processes at zero value with a warning', () => {
    const input = baseInput()
    input.processes = []
    input.opportunity.processIds = []
    const result = scoreOpportunity(input)
    expect(result.annualValue).toBe(0)
    expect(result.hoursSavedPerMonth).toBe(0)
    expect(result.valueScore).toBe(0)
    expect(warningCodes(result)).toContain('NO_PROCESSES')
    expect(row(result, 'Strategic multiplier').value).toBe(1)
  })

  it('warns about a linked process that was not supplied and scores the rest', () => {
    const input = baseInput()
    input.opportunity.processIds = ['proc-1', 'proc-missing']
    const result = scoreOpportunity(input)
    expect(result.annualValue).toBeCloseTo(8755.2, 10)
    expect(result.warnings.find((warning) => warning.code === 'MISSING_PROCESS')?.message).toContain('proc-missing')
  })
})

describe('scoreOpportunity effort (§1.2)', () => {
  it('computes the worked example', () => {
    const result = scoreOpportunity(baseInput())
    // one integration (2), semi-structured (2), one approval (1.5), medium volume (1)
    expect(result.effortPoints).toBe(6.5)
    expect(result.rawBuildHours).toBeCloseTo(21 + 6.5 * 1.5, 10)
    expect(result.effortScore).toBe(38)
  })

  it('adds every factor from the table', () => {
    const input = baseInput()
    input.opportunity.effortInputs = {
      integrations: [
        { name: 'A', hasPublicApi: true, authAvailable: true },
        { name: 'B', hasPublicApi: false, authAvailable: true },
        { name: 'C', hasPublicApi: true, authAvailable: false },
      ],
      dataReadiness: 'unstructured',
      approvalSteps: 2,
      complianceFlags: ['GDPR', 'PCI'],
      volumeTier: 'high',
      novelty: 'new',
      requiresHumanInLoop: true,
    }
    const result = scoreOpportunity(input)
    // 3×2 + 4 + 3 + 5 + 2×1.5 + 2×3 + 3 + 5 + 2
    expect(result.effortPoints).toBe(37)
    expect(row(result, 'Integrations without a public API').value).toBe(4)
    expect(row(result, 'Integrations without available auth').value).toBe(3)
    expect(row(result, 'Compliance flags').value).toBe(6)
    expect(row(result, 'Human in the loop').value).toBe(2)
  })

  it('uses uncalibrated pattern hours, summed over every linked pattern', () => {
    const result = scoreOpportunity(baseInput())
    expect(row(result, 'Base hours (uncalibrated)')).toMatchObject({ value: 21, source: 'estimated' })
  })

  it('falls back to the configured hours when no pattern is linked', () => {
    const input = baseInput()
    input.opportunity.patternIds = []
    input.patterns = []
    const result = scoreOpportunity(input)
    expect(row(result, 'Base hours (uncalibrated)')).toMatchObject({ value: 8, source: 'default' })
    expect(result.rawBuildHours).toBeCloseTo(8 + 6.5 * 1.5, 10)
    expect(warningCodes(result)).toContain('NO_PATTERN')
  })

  it('warns about a linked pattern that was not supplied and sums the rest', () => {
    const input = baseInput()
    input.patterns = [{ id: 'pat-email-triage', baseHours: 12 }]
    const result = scoreOpportunity(input)
    expect(row(result, 'Base hours (uncalibrated)').value).toBe(12)
    expect(result.warnings.find((warning) => warning.code === 'MISSING_PATTERN')?.message).toContain('pat-crm-sync')
    input.patterns = []
    expect(row(scoreOpportunity(input), 'Base hours (uncalibrated)').value).toBe(8)
  })

  it('caps the effort score at 100', () => {
    const input = baseInput()
    input.config.scoring.effortCeiling = 10
    expect(scoreOpportunity(input).effortScore).toBe(100)
  })
})

describe('scoreOpportunity confidence (§1.3)', () => {
  it('computes the worked example', () => {
    // one default (error reduction), four estimated (blended cost, error rate, cost per
    // error, automatable), pattern linked, blended cost not client-stated
    expect(scoreOpportunity(baseInput()).confidence).toBe(100 - 12 - 4 * 6 - 10)
  })

  it('reaches 100 when every input is client-stated and a pattern is linked', () => {
    expect(scoreOpportunity(withSource(baseInput(), 'client-stated')).confidence).toBe(100)
  })

  it('never drops below the floor', () => {
    const input = withSource(baseInput(), 'default')
    input.opportunity.patternIds = []
    input.patterns = []
    expect(scoreOpportunity(input).confidence).toBe(CONFIDENCE_MIN)
  })

  it('penalises a missing pattern by 15', () => {
    const input = withSource(baseInput(), 'client-stated')
    input.opportunity.patternIds = []
    input.patterns = []
    expect(scoreOpportunity(input).confidence).toBe(100 - 15)
  })

  it('penalises a non-client-stated hourly cost by 10, once', () => {
    const input = withSource(baseInput(), 'client-stated')
    const measured: TracedValue = { value: 16, unit: 'EUR/hour', currency: 'EUR', source: 'measured' }
    input.company.blendedHourlyCost = measured
    const first = input.processes[0]
    if (first === undefined) throw new Error('baseInput has one process')
    const second: Process = { ...structuredClone(first), id: 'proc-2', name: 'Second', roleHourlyCost: { ...measured } }
    input.processes = [first, second]
    input.opportunity.processIds = ['proc-1', 'proc-2']
    expect(scoreOpportunity(input).confidence).toBe(100 - 10)
  })

  it('penalises a missing hourly cost like a non-client-stated one', () => {
    const input = withSource(baseInput(), 'client-stated')
    input.company.blendedHourlyCost = null
    expect(scoreOpportunity(input).confidence).toBe(100 - 10)
  })

  it('counts a shared company rate once across processes', () => {
    const input = withSource(baseInput(), 'client-stated')
    input.company.blendedHourlyCost = { value: 16, unit: 'EUR/hour', currency: 'EUR', source: 'estimated' }
    const first = input.processes[0]
    if (first === undefined) throw new Error('baseInput has one process')
    const second: Process = { ...structuredClone(first), id: 'proc-2', name: 'Second' }
    input.processes = [first, second]
    input.opportunity.processIds = ['proc-1', 'proc-2']
    const result = scoreOpportunity(input)
    expect(result.confidence).toBe(100 - 6 - 10)
    expect(result.assumptions.filter((traced) => traced === input.company.blendedHourlyCost)).toHaveLength(1)
  })

  it('warns below the proposal gate', () => {
    expect(warningCodes(scoreOpportunity(baseInput()))).not.toContain('LOW_CONFIDENCE')
    const input = withSource(baseInput(), 'estimated')
    expect(scoreOpportunity(input).confidence).toBeLessThan(LOW_CONFIDENCE_THRESHOLD)
    expect(warningCodes(scoreOpportunity(input))).toContain('LOW_CONFIDENCE')
  })
})

describe('scoreOpportunity priority and quadrant (§1.4)', () => {
  it('computes the worked example', () => {
    const result = scoreOpportunity(baseInput())
    expect(result.priorityIndex).toBeCloseTo((36 * 54) / 100 / (0.5 + 38 / 100), 10)
    expect(result.quadrant).toBe('fill-in')
  })

  it('places each quadrant from the score thresholds', () => {
    const quickWin = baseInput()
    quickWin.config.scoring.valueCeiling = 1000
    expect(scoreOpportunity(quickWin).quadrant).toBe('quick-win')

    const strategic = baseInput()
    strategic.config.scoring.valueCeiling = 1000
    strategic.config.scoring.effortCeiling = 10
    expect(scoreOpportunity(strategic).quadrant).toBe('strategic')

    const avoid = baseInput()
    avoid.config.scoring.effortCeiling = 10
    expect(scoreOpportunity(avoid).quadrant).toBe('avoid')
  })

  it('treats exactly 50 as high value and high effort', () => {
    const input = baseInput()
    // weighted 10944 → 100 × 10944 / 21888 = 50; raw 30.75 → 100 × 30.75 / 61.5 = 50
    input.config.scoring.valueCeiling = 21888
    input.config.scoring.effortCeiling = 61.5
    const result = scoreOpportunity(input)
    expect(result.valueScore).toBe(50)
    expect(result.effortScore).toBe(50)
    expect(result.quadrant).toBe('strategic')
  })
})

describe('scoreOpportunity output shape', () => {
  it('lists every TracedValue that fed the score, in order of use', () => {
    const input = baseInput()
    const process = input.processes[0]
    if (process === undefined) throw new Error('baseInput has one process')
    expect(scoreOpportunity(input).assumptions).toEqual([
      process.frequency.occurrencesPerMonth,
      process.frequency.minutesPerOccurrence,
      process.frequency.peopleInvolved,
      input.company.blendedHourlyCost,
      process.errorProfile.errorRatePercent,
      process.errorProfile.costPerError,
      input.opportunity.automatablePercent,
      input.opportunity.errorReductionPercent,
    ])
  })

  it('shows the working for every figure', () => {
    const result = scoreOpportunity(baseInput())
    expectRow(result, 'Quote request to CRM entry: hours wasted per month', {
      value: 48,
      unit: 'hours/month',
      source: 'measured',
      formula: '(120 × 12 × 2) / 60',
    })
    expectRow(result, 'Quote request to CRM entry: recoverable hours per month', {
      value: 33.6,
      unit: 'hours/month',
      source: 'estimated',
      formula: '48 × 70%',
    })
    expectRow(result, 'Quote request to CRM entry: effective hourly cost', {
      value: 16,
      unit: 'EUR/hour',
      source: 'estimated',
      formula: '16 EUR, company blended rate',
    })
    expectRow(result, 'Quote request to CRM entry: annual labour value', {
      value: 6451.2,
      unit: 'EUR/year',
      source: 'estimated',
      formula: '33.6 × 12 × 16',
    })
    expectRow(result, 'Quote request to CRM entry: annual error value', {
      value: 2304,
      unit: 'EUR/year',
      source: 'default',
      formula: '120 × 12 × 5% × 40 × 80%',
    })
    expectRow(result, 'Annual value', { value: 8755.2, unit: 'EUR/year', source: 'default' })
    expectRow(result, 'Hours saved per month', { value: 33.6, unit: 'hours/month' })
    expectRow(result, 'Value score', { value: 36, unit: 'points' })
    expectRow(result, 'Effort points', { value: 6.5, unit: 'points', source: 'estimated' })
    expectRow(result, 'Raw build hours', { value: 30.75, unit: 'hours', formula: '21 + 6.5 × 1.5' })
    expectRow(result, 'Effort score', { value: 38, unit: 'points' })
    expectRow(result, 'Confidence', { value: 54, unit: 'percent' })
    expect(row(result, 'Confidence').formula).toContain('12 × 1')
    expect(row(result, 'Confidence').formula).toContain('6 × 4')
    expectRow(result, 'Priority index', {
      value: (36 * 54) / 100 / 0.88,
      unit: 'index',
      formula: '(36 × 54 / 100) / (0.5 + 38 / 100)',
    })
    for (const entry of result.breakdown) {
      expect(Number.isFinite(entry.value), entry.label).toBe(true)
      expect(entry.formula, entry.label).not.toBe('')
    }
  })

  it('marks exactly the ranking figures internal and every other row client-facing', () => {
    const result = scoreOpportunity(baseInput())
    const internal = result.breakdown.filter((entry) => entry.audience === 'internal').map((entry) => entry.label)
    expect(internal).toEqual(['Strategic multiplier', 'Value score', 'Effort score', 'Priority index'])
    expect(result.breakdown.every((entry) => entry.audience === 'client' || internal.includes(entry.label))).toBe(true)
  })

  it('leaves the weighted value recoverable from no row: the value-score formula names the multiplier instead of printing it', () => {
    const result = scoreOpportunity(baseInput())
    // Weighted value 10944 = annual value 8755.2 × direct-impact multiplier 1.25.
    expect(result.weightedValue).toBeCloseTo(10944, 10)
    const valueScore = row(result, 'Value score').formula
    expect(valueScore).toBe('min(100, round(100 × 8755.2 × strategic multiplier / 30000))')
    for (const entry of result.breakdown.filter((candidate) => candidate.audience === 'client')) {
      expect(entry.formula, entry.label).not.toContain('10944')
      expect(entry.formula, entry.label).not.toContain('1.25')
      expect(entry.label, entry.label).not.toMatch(/weighted|strategic/i)
    }
  })

  it('stamps computedAt from the injected clock and keeps it out of the hash', () => {
    const a = scoreOpportunity(baseInput())
    const b = scoreOpportunity({ ...baseInput(), now: '2030-01-01T00:00:00.000Z' })
    expect(a.computedAt).toBe(NOW)
    expect(b.computedAt).toBe('2030-01-01T00:00:00.000Z')
    expect(b.inputsHash).toBe(a.inputsHash)
  })

  it('changes the hash when a scoring input changes', () => {
    const base = scoreOpportunity(baseInput()).inputsHash
    const automatable = baseInput()
    automatable.opportunity.automatablePercent = { ...automatable.opportunity.automatablePercent, value: 71 }
    expect(scoreOpportunity(automatable).inputsHash).not.toBe(base)
    const rate = baseInput()
    rate.config.scoring.hoursPerEffortPoint = 2
    expect(scoreOpportunity(rate).inputsHash).not.toBe(base)
    const fx = baseInput()
    fx.config.fxRates.rates.GBP = 0.9
    expect(scoreOpportunity(fx).inputsHash).not.toBe(base)
    const note = baseInput()
    note.opportunity.automatablePercent = { ...note.opportunity.automatablePercent, note: 'revised' }
    expect(scoreOpportunity(note).inputsHash).not.toBe(base)
  })

  it('keeps the hash stable when an unread field changes', () => {
    const base = scoreOpportunity(baseInput()).inputsHash
    const input = baseInput()
    input.opportunity.title = 'Renamed'
    input.opportunity.summary = 'Rewritten'
    input.opportunity.selected = false
    input.opportunity.primaryPatternId = 'pat-crm-sync'
    input.opportunity.scoring = scoreOpportunity(baseInput())
    input.company.name = 'Renamed Ltd'
    input.config.storage.lastSyncAt = '2026-09-15T12:00:00.000Z'
    input.config.pricing.targetHourlyRate = 90
    input.config.agency.email = 'alex@example.com'
    expect(scoreOpportunity(input).inputsHash).toBe(base)
  })

  it('does not mutate its inputs', () => {
    const input = baseInput()
    const copy = structuredClone(input)
    scoreOpportunity(input)
    expect(input).toEqual(copy)
  })
})

describe('calibration isolation', () => {
  it('has no calibration code path at all', () => {
    // 'uncalibrated' is the spec's own label for raw pattern hours; anything else is a leak.
    expect(scoringSource).not.toMatch(/(?<!un)calibrat/i)
  })

  it('ignores calibration data passed alongside its inputs', () => {
    const lookup = buildCalibrationLookup([
      {
        patternId: 'pat-email-triage',
        samples: [20, 21, 22].map((estimatedHours) => ({
          engagementId: 'eng',
          estimatedHours,
          actualHours: estimatedHours * 3,
          completedAt: NOW,
        })),
        multiplier: 3,
        sampleCount: 3,
        trustworthy: true,
      },
    ])
    const plain = scoreOpportunity(baseInput())
    // A variable rather than a literal: the extra key is the point, and a literal would be
    // rejected by the excess-property check before it ever reached the engine.
    const input = { ...baseInput(), calibration: lookup }
    const withCalibration = scoreOpportunity(input)
    expect(withCalibration).toEqual(plain)
    expect(plain.rawBuildHours).toBeCloseTo(21 + 6.5 * 1.5, 10)
  })
})

describe('scoreOpportunity invariants', () => {
  const CASES = 300

  it('increasing automatablePercent never decreases annualValue', () => {
    const random = mulberry32(31)
    for (let i = 0; i < CASES; i++) {
      const input = randomScoringInput(random)
      const before = scoreOpportunity(input).annualValue
      const raised = structuredClone(input)
      raised.opportunity.automatablePercent.value += randomNumber(random, 0, 50)
      expect(scoreOpportunity(raised).annualValue, `case ${i}`).toBeGreaterThanOrEqual(before)
    }
  })

  it('increasing any effort factor never decreases rawBuildHours', () => {
    const random = mulberry32(32)
    for (let i = 0; i < CASES; i++) {
      const input = randomScoringInput(random)
      const before = scoreOpportunity(input).rawBuildHours
      const raised = structuredClone(input)
      const effort = raised.opportunity.effortInputs
      switch (randomInt(random, 0, 6)) {
        case 0:
          effort.integrations.push({ name: 'extra', hasPublicApi: random() < 0.5, authAvailable: random() < 0.5 })
          break
        case 1:
          effort.dataReadiness = effort.dataReadiness === 'structured' ? 'semi-structured' : 'unstructured'
          break
        case 2:
          effort.approvalSteps += randomInt(random, 1, 3)
          break
        case 3:
          effort.complianceFlags.push('extra')
          break
        case 4:
          effort.volumeTier = effort.volumeTier === 'low' ? 'medium' : 'high'
          break
        case 5:
          effort.novelty = effort.novelty === 'known-pattern' ? 'similar-pattern' : 'new'
          break
        default:
          effort.requiresHumanInLoop = true
      }
      expect(scoreOpportunity(raised).rawBuildHours, `case ${i}`).toBeGreaterThanOrEqual(before)
    }
  })

  it('replacing an estimated source with client-stated never decreases confidence', () => {
    const random = mulberry32(33)
    for (let i = 0; i < CASES; i++) {
      const input = randomScoringInput(random)
      const before = scoreOpportunity(input).confidence
      const promoted = structuredClone(input)
      const candidates: TracedValue[] = [
        promoted.opportunity.automatablePercent,
        promoted.opportunity.errorReductionPercent,
        ...(promoted.company.blendedHourlyCost === null ? [] : [promoted.company.blendedHourlyCost]),
        ...promoted.processes.flatMap((process) => [
          process.frequency.occurrencesPerMonth,
          process.frequency.minutesPerOccurrence,
          process.frequency.peopleInvolved,
          ...(process.roleHourlyCost === null ? [] : [process.roleHourlyCost]),
          ...(process.errorProfile.errorRatePercent === null ? [] : [process.errorProfile.errorRatePercent]),
          ...(process.errorProfile.costPerError === null ? [] : [process.errorProfile.costPerError]),
        ]),
      ].filter((traced) => traced.source === 'estimated')
      if (candidates.length === 0) continue
      pick(random, candidates).source = 'client-stated'
      expect(scoreOpportunity(promoted).confidence, `case ${i}`).toBeGreaterThanOrEqual(before)
    }
  })

  it('annualValue is 0 when no hourly cost is available and no error value exists', () => {
    const random = mulberry32(34)
    for (let i = 0; i < CASES; i++) {
      const input = randomScoringInput(random)
      input.company.blendedHourlyCost = null
      for (const process of input.processes) {
        process.roleHourlyCost = null
        if (random() < 0.5) process.errorProfile.errorRatePercent = null
        else process.errorProfile.costPerError = null
      }
      expect(scoreOpportunity(input).annualValue, `case ${i}`).toBe(0)
    }
  })

  it('calibration data has no effect on any scoring output', () => {
    const random = mulberry32(35)
    for (let i = 0; i < CASES; i++) {
      const input = randomScoringInput(random)
      const calibration = Object.fromEntries(
        input.patterns.map((pattern) => [
          pattern.id,
          { multiplier: randomNumber(random, 0.5, 3), sampleCount: randomInt(random, 0, 20), trustworthy: random() < 0.5 },
        ]),
      )
      const withCalibration = { ...input, calibration }
      expect(scoreOpportunity(withCalibration), `case ${i}`).toEqual(scoreOpportunity(input))
    }
  })

  it('keeps every score in [0, 100] and confidence in [15, 100]', () => {
    const random = mulberry32(36)
    for (let i = 0; i < CASES; i++) {
      const result = scoreOpportunity(randomScoringInput(random))
      for (const score of [result.valueScore, result.effortScore]) {
        expect(score, `case ${i}`).toBeGreaterThanOrEqual(0)
        expect(score, `case ${i}`).toBeLessThanOrEqual(100)
        expect(Number.isInteger(score), `case ${i}`).toBe(true)
      }
      expect(result.confidence, `case ${i}`).toBeGreaterThanOrEqual(CONFIDENCE_MIN)
      expect(result.confidence, `case ${i}`).toBeLessThanOrEqual(CONFIDENCE_MAX)
      expect(Number.isFinite(result.priorityIndex), `case ${i}`).toBe(true)
      expect(result.priorityIndex, `case ${i}`).toBeGreaterThanOrEqual(0)
    }
  })

  it('the same inputs always produce the same inputsHash', () => {
    const random = mulberry32(37)
    for (let i = 0; i < CASES; i++) {
      const input = randomScoringInput(random)
      const hash = scoreOpportunity(input).inputsHash
      expect(scoreOpportunity(structuredClone(input)).inputsHash, `case ${i}`).toBe(hash)
      expect(scoreOpportunity({ ...input, now: '1999-12-31T23:59:59.000Z' }).inputsHash, `case ${i}`).toBe(hash)
    }
  })
})
