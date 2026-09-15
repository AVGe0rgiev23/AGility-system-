import type { Config } from '../schema/config'
import type { Opportunity } from '../schema/opportunity'
import type { EstimateFlag, EstimateResult, ScoringResult } from '../schema/results'
import { lookupCalibration, type CalibrationLookup } from './calibration'
import { hashInputs } from './inputs-hash'
import { LOW_CONFIDENCE_THRESHOLD } from './scoring'

export interface ScoredOpportunity {
  opportunity: Opportunity
  scoring: ScoringResult
}

export interface EstimateInput {
  // The selected set. Scoring is uncalibrated; the multiplier is applied here and nowhere else.
  scored: ScoredOpportunity[]
  config: Config
  calibration: CalibrationLookup
  // Pre-summed by the caller from the selected blueprints. Copied out as a cross-check, never priced.
  advisoryBlueprintHours: number | null
  // ISO timestamp from the caller. Copied to computedAt, never hashed.
  now: string
}

type PricingBand = Config['pricing']['bands'][number]

const OVERHEAD_KEYS = ['discovery', 'testing', 'documentation', 'deployment'] as const

// First bounded band the hours fit in, else the unbounded one. ConfigSchema guarantees the
// bounded bands ascend and exactly one unbounded band, with id 'custom', comes last. Without an
// unbounded band a large scope has nowhere to go, so that alone is thrown rather than flagged.
function placeBand(bands: readonly PricingBand[], totalHours: number): PricingBand {
  const bounded = bands.find((band) => band.maxHours !== null && totalHours <= band.maxHours)
  if (bounded !== undefined) return bounded
  const unbounded = bands.find((band) => band.maxHours === null)
  if (unbounded === undefined) {
    throw new Error("Config.pricing.bands has no unbounded band; ConfigSchema requires exactly one, last, with id 'custom'")
  }
  return unbounded
}

export function estimateScope(input: EstimateInput): EstimateResult {
  const { scored, config, calibration, advisoryBlueprintHours, now } = input

  const perOpportunity = scored.map(({ opportunity, scoring }) => {
    // No primary pattern, or a primary pattern with no calibration record, is an
    // uncalibrated estimate either way: the multiplier is 1 by absence, not by evidence.
    const entry = lookupCalibration(calibration, opportunity.primaryPatternId)
    const multiplier = entry?.multiplier ?? 1.0
    return {
      opportunityId: opportunity.id,
      rawHours: scoring.rawBuildHours,
      multiplier,
      trustworthy: entry?.trustworthy ?? false,
      calibratedHours: scoring.rawBuildHours * multiplier,
    }
  })
  const calibratedHours = perOpportunity.reduce((sum, entry) => sum + entry.calibratedHours, 0)

  // Overheads are additive on calibrated hours; contingency applies to the subtotal after them.
  const overheads = config.estimation.overheads
  const overheadBreakdown = OVERHEAD_KEYS.map((label) => ({ label, hours: calibratedHours * overheads[label] }))
  const overheadFactor = OVERHEAD_KEYS.reduce((sum, key) => sum + overheads[key], 0)
  const subtotalHours = calibratedHours * (1 + overheadFactor)
  const contingencyHours = subtotalHours * config.estimation.contingency
  const totalHours = subtotalHours + contingencyHours

  const flags: EstimateFlag[] = []
  let bandId: string | null = null
  let indicativePrice = 0
  let price = 0
  let effectiveHourlyRate: number | null = null

  if (totalHours === 0) {
    // Placing an empty scope would clamp it up to the pilot floor, and price / hours has no answer.
    flags.push('EMPTY_SCOPE')
  } else {
    const band = placeBand(config.pricing.bands, totalHours)
    bandId = band.id
    indicativePrice = totalHours * config.pricing.targetHourlyRate
    if (band.maxHours === null) {
      // The unbounded band has no published price. The quote and the flag share this one
      // predicate, so an unclamped price can never go out unflagged, whatever the band's id.
      price = indicativePrice
      flags.push('CUSTOM_QUOTE')
    } else if (band.floor === null || band.ceiling === null) {
      // ConfigSchema requires both limits on a bounded band, so invalid Config escaped
      // validation. There is nothing to clamp to; flagging it surfaces the cause, where a
      // throw here would only crash the price calculation.
      price = indicativePrice
      flags.push('INVALID_BAND_CONFIG')
    } else {
      price = Math.min(band.ceiling, Math.max(band.floor, indicativePrice))
      if (indicativePrice > band.ceiling) flags.push('UNDERPRICED')
      else if (indicativePrice < band.floor) flags.push('BELOW_FLOOR')
    }
    effectiveHourlyRate = price / totalHours
  }
  if (scored.some(({ scoring }) => scoring.confidence < LOW_CONFIDENCE_THRESHOLD)) flags.push('LOW_CONFIDENCE')
  if (perOpportunity.some((entry) => !entry.trustworthy)) flags.push('UNCALIBRATED_PATTERN')

  // Exactly the inputs read above: the calibration entries of the primary patterns in use,
  // not the whole lookup, so a sample landing on an unrelated pattern changes nothing here.
  const inputsHash = hashInputs({
    scored: scored.map(({ opportunity, scoring }) => ({
      opportunityId: opportunity.id,
      primaryPatternId: opportunity.primaryPatternId,
      rawBuildHours: scoring.rawBuildHours,
      confidence: scoring.confidence,
      calibration: lookupCalibration(calibration, opportunity.primaryPatternId) ?? null,
    })),
    config: {
      targetHourlyRate: config.pricing.targetHourlyRate,
      bands: config.pricing.bands,
      overheads,
      contingency: config.estimation.contingency,
    },
    advisoryBlueprintHours,
  })

  return {
    calibratedHours,
    overheadBreakdown,
    contingencyHours,
    totalHours,
    bandId,
    indicativePrice,
    price,
    effectiveHourlyRate,
    flags,
    perOpportunity,
    advisoryBlueprintHours,
    inputsHash,
    computedAt: now,
  }
}
