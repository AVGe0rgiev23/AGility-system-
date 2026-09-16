import {
  businessProcess,
  company,
  estimateResult,
  opportunity,
  runCostResult,
  scoringResult,
} from '../../schema/__fixtures__/records'
import { defaultConfig, type Config } from '../../schema/config'
import type { Pattern } from '../../schema/library'
import type { EffortInputs, Opportunity } from '../../schema/opportunity'
import type { Process } from '../../schema/process'
import type { EstimateResult, RunCostResult, ScoringResult } from '../../schema/results'
import type { RunCostLineItem } from '../../schema/run-cost'
import type { Currency, Source, TracedValue } from '../../schema/traced'
import type { ScoringInput } from '../scoring'

// Test-only helpers for the engine suites. No vitest import: the import allowlist scans this file.

// Shaped like the engines' own input types, spelled with schema types so this file does not
// depend on an engine module before it exists.
export interface ScoredOpportunity {
  opportunity: Opportunity
  scoring: ScoringResult
}

export type CalibrationLookup = Record<
  string,
  { multiplier: number; sampleCount: number; usableSampleCount: number; trustworthy: boolean }
>

export interface ROIInput {
  scored: ScoredOpportunity[]
  estimate: EstimateResult
  runCost: RunCostResult
  config: Config
  now: string
}

// mulberry32: a tiny seeded generator, so a property test that fails does so on every run
// with the same case index, and Math.random stays out of the engines folder entirely.
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type Random = () => number

// The codes a result warned with, so tests assert on the vocabulary and never on message prose.
export function warningCodes(result: { warnings: readonly { code: string }[] }): string[] {
  return result.warnings.map((warning) => warning.code)
}

export function randomInt(random: Random, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1))
}

export function randomNumber(random: Random, min: number, max: number): number {
  return min + random() * (max - min)
}

export function pick<T>(random: Random, options: readonly T[]): T {
  const index = Math.floor(random() * options.length)
  const chosen = options[index]
  if (chosen === undefined) throw new Error('pick needs a non-empty list')
  return chosen
}

// Plain JSON-shaped data of bounded depth, for hashing and serialisation tests.
export function randomPlainValue(random: Random, depth = 0): unknown {
  const kind = depth >= 3 ? randomInt(random, 0, 4) : randomInt(random, 0, 6)
  switch (kind) {
    case 0:
      return null
    case 1:
      return random() < 0.5
    case 2:
      return Math.round(randomNumber(random, -1e6, 1e6) * 100) / 100
    case 3:
      return randomInt(random, -1000, 1000)
    case 4:
      return `s${randomInt(random, 0, 999)}`
    case 5:
      return Array.from({ length: randomInt(random, 0, 4) }, () => randomPlainValue(random, depth + 1))
    default: {
      const object: Record<string, unknown> = {}
      for (let i = randomInt(random, 0, 4); i > 0; i--) {
        object[`k${randomInt(random, 0, 9)}`] = randomPlainValue(random, depth + 1)
      }
      return object
    }
  }
}

// ---- Scoring inputs -------------------------------------------------------------------

export const SOURCES: readonly Source[] = ['client-stated', 'measured', 'estimated', 'default']
export const CURRENCIES: readonly Currency[] = ['EUR', 'GBP', 'USD']

export function randomSource(random: Random): Source {
  return pick(random, SOURCES)
}

export function randomTraced(random: Random, value: number, unit: string): TracedValue {
  return { value, unit, source: randomSource(random) }
}

// A money value in a random currency; `perUnit` gives 'EUR/hour' style units.
export function randomMoney(random: Random, value: number, perUnit?: string): TracedValue {
  const currency = pick(random, CURRENCIES)
  const unit = perUnit === undefined ? currency : `${currency}/${perUnit}`
  return { value, unit, currency, source: randomSource(random) }
}

// Every numeric input is non-negative, so the monotonicity invariants are meaningful.
export function randomProcess(random: Random, id: string): Process {
  const withErrors = random() < 0.6
  return {
    ...businessProcess(),
    id,
    name: `Process ${id}`,
    frequency: {
      occurrencesPerMonth: randomTraced(random, randomInt(random, 0, 500), 'count/month'),
      minutesPerOccurrence: randomTraced(random, randomInt(random, 0, 240), 'minutes'),
      peopleInvolved: randomTraced(random, randomInt(random, 1, 5), 'count'),
    },
    roleHourlyCost: random() < 0.5 ? randomMoney(random, randomNumber(random, 5, 120), 'hour') : null,
    errorProfile: {
      errorRatePercent: withErrors ? randomTraced(random, randomNumber(random, 0, 30), 'percent') : null,
      costPerError: withErrors || random() < 0.3 ? randomMoney(random, randomNumber(random, 0, 500)) : null,
    },
    revenueImpact: pick(random, ['direct', 'indirect', 'none'] as const),
  }
}

export function randomEffortInputs(random: Random): EffortInputs {
  return {
    integrations: Array.from({ length: randomInt(random, 0, 4) }, (_, i) => ({
      name: `Integration ${i}`,
      hasPublicApi: random() < 0.7,
      authAvailable: random() < 0.7,
    })),
    dataReadiness: pick(random, ['structured', 'semi-structured', 'unstructured'] as const),
    approvalSteps: randomInt(random, 0, 4),
    complianceFlags: Array.from({ length: randomInt(random, 0, 3) }, (_, i) => `flag-${i}`),
    volumeTier: pick(random, ['low', 'medium', 'high'] as const),
    novelty: pick(random, ['known-pattern', 'similar-pattern', 'new'] as const),
    requiresHumanInLoop: random() < 0.5,
  }
}

export function randomScoringInput(random: Random): ScoringInput {
  const processes = Array.from({ length: randomInt(random, 0, 3) }, (_, i) => randomProcess(random, `proc-${i}`))
  const patterns: Pick<Pattern, 'id' | 'baseHours'>[] = Array.from({ length: randomInt(random, 0, 3) }, (_, i) => ({
    id: `pat-${i}`,
    baseHours: randomNumber(random, 1, 40),
  }))
  const opp: Opportunity = {
    ...opportunity(),
    processIds: processes.map((process) => process.id),
    patternIds: patterns.map((pattern) => pattern.id),
    primaryPatternId: patterns[0]?.id ?? null,
    automatablePercent: randomTraced(random, randomNumber(random, 0, 100), 'percent'),
    errorReductionPercent: randomTraced(random, randomNumber(random, 0, 100), 'percent'),
    effortInputs: randomEffortInputs(random),
  }
  const blendedHourlyCost = random() < 0.7 ? randomMoney(random, randomNumber(random, 5, 120), 'hour') : null
  const config: Config = defaultConfig()
  // Vary the ceilings so both the capped and uncapped score branches are exercised.
  config.scoring.valueCeiling = pick(random, [3000, 30000, 300000])
  config.scoring.effortCeiling = pick(random, [20, 80, 400])
  return {
    opportunity: opp,
    processes,
    patterns,
    company: { ...company(), blendedHourlyCost },
    config,
    now: '2026-09-15T00:00:00.000Z',
  }
}

// ---- Scope inputs (estimate, run cost, ROI) --------------------------------------------

export const PATTERN_IDS = ['pat-a', 'pat-b', 'pat-c'] as const

// A scored opportunity as the estimate and ROI engines receive it. Raw hours are 0 one time
// in ten so the empty-scope path is exercised.
export function randomScored(random: Random, index: number): ScoredOpportunity {
  return {
    opportunity: {
      ...opportunity(),
      id: `opp-${index}`,
      primaryPatternId: random() < 0.2 ? null : pick(random, PATTERN_IDS),
    },
    scoring: {
      ...scoringResult(),
      annualValue: randomNumber(random, 0, 60000),
      hoursSavedPerMonth: randomNumber(random, 0, 200),
      rawBuildHours: random() < 0.1 ? 0 : randomNumber(random, 0.5, 150),
      confidence: randomInt(random, 15, 100),
      assumptions: [randomTraced(random, randomNumber(random, 0, 100), 'percent'), randomMoney(random, randomNumber(random, 5, 120), 'hour')],
      computedAt: `2026-0${randomInt(random, 1, 9)}-01T00:00:00.000Z`,
    },
  }
}

export function randomScoredSet(random: Random): ScoredOpportunity[] {
  return Array.from({ length: randomInt(random, 0, 4) }, (_, index) => randomScored(random, index))
}

export function randomCalibration(random: Random): CalibrationLookup {
  const lookup: CalibrationLookup = {}
  for (const patternId of PATTERN_IDS) {
    if (random() < 0.3) continue
    const sampleCount = randomInt(random, 0, 12)
    const usableSampleCount = randomInt(random, 0, sampleCount)
    lookup[patternId] = {
      multiplier: usableSampleCount < 3 ? 1 : randomNumber(random, 0.5, 3),
      sampleCount,
      usableSampleCount,
      trustworthy: usableSampleCount >= 3,
    }
  }
  return lookup
}

export function randomRunCostItem(random: Random, index: number): RunCostLineItem {
  const payer = (): 'client' | 'agency' | 'not-applicable' => pick(random, ['client', 'agency', 'not-applicable'] as const)
  const usageBased = random() < 0.3
  return {
    id: `rc-${index}`,
    label: `Item ${index}`,
    category: pick(random, ['hosting', 'database', 'scheduler', 'ai', 'monitoring', 'domain', 'third-party', 'other'] as const),
    // A usage-based item may carry a monthly cost or none; the engine must ignore it either way.
    monthlyCost: usageBased && random() < 0.5 ? null : randomNumber(random, 0, 200),
    paidBy: { 'fully-managed': payer(), 'client-owned': payer(), hybrid: payer() },
    usageBased,
    ...(usageBased
      ? {
          usageFormula: {
            callsPerMonth: randomInt(random, 0, 50000),
            avgInputTokens: randomInt(random, 0, 4000),
            avgOutputTokens: randomInt(random, 0, 1000),
            inputPricePerMTok: randomNumber(random, 0, 5),
            outputPricePerMTok: randomNumber(random, 0, 20),
          },
        }
      : {}),
  }
}

export function randomROIInput(random: Random): ROIInput {
  const agencyMonthly = randomNumber(random, 0, 800)
  const config = defaultConfig()
  config.roi.discountRate = pick(random, [0, 0.08, 0.2])
  config.roi.horizonYears = randomInt(random, 1, 5)
  return {
    scored: randomScoredSet(random),
    estimate: { ...estimateResult(), price: random() < 0.1 ? 0 : randomNumber(random, 0, 20000) },
    runCost: {
      ...runCostResult(),
      clientMonthly: randomNumber(random, 0, 800),
      agencyMonthly,
      agencyAnnual: agencyMonthly * 12,
    },
    config,
    now: '2026-09-15T00:00:00.000Z',
  }
}
