import { z } from 'zod'
import { DeliveryModelSchema } from './company'
import { SourceSchema, TracedValueSchema } from './traced'

// Engine results are cached on records but never authoritative: a mismatched
// inputsHash triggers a recompute. They are still validated on every read.

// Each engine warns from a fixed vocabulary (ENGINES), so screens and documents act on the
// code and never parse the message, which is prose for Alex to read.
export const ScoringWarningCodeSchema = z.enum([
  'MISSING_PROCESS',
  'MISSING_PATTERN',
  'NO_PROCESSES',
  'NO_HOURLY_COST',
  'NON_HOURLY_COST_UNIT',
  'NO_PATTERN',
  'LOW_CONFIDENCE',
])
export type ScoringWarningCode = z.infer<typeof ScoringWarningCodeSchema>

export const RunCostWarningCodeSchema = z.enum([
  'MISSING_USAGE_FORMULA',
  'AGENCY_COST_UNDER_CLIENT_OWNED',
  'RETAINER_MARGIN_THIN',
  'RETAINER_NOT_SET',
])
export type RunCostWarningCode = z.infer<typeof RunCostWarningCodeSchema>

export const ROIWarningCodeSchema = z.enum([
  'EMPTY_SCOPE',
  'NO_IMPLEMENTATION_COST',
  'NO_PAYBACK',
  'PAYBACK_TOO_LONG',
  'LOW_CONFIDENCE',
  'RUN_COST_EATS_CASE',
  'DEFAULT_COST',
])
export type ROIWarningCode = z.infer<typeof ROIWarningCodeSchema>

export const ScoringResultSchema = z.object({
  // EUR, unweighted. The only value figure that may reach a client.
  annualValue: z.number(),
  // Internal ranking only. Never shown to a client.
  weightedValue: z.number(),
  valueScore: z.number(),
  effortPoints: z.number(),
  // Uncalibrated. Calibration is applied in estimation and nowhere else.
  rawBuildHours: z.number(),
  effortScore: z.number(),
  confidence: z.number(),
  priorityIndex: z.number(),
  quadrant: z.enum(['quick-win', 'strategic', 'fill-in', 'avoid']),
  hoursSavedPerMonth: z.number(),
  breakdown: z.array(
    z.object({
      label: z.string(),
      value: z.number(),
      unit: z.string(),
      source: SourceSchema,
      formula: z.string(),
    }),
  ),
  assumptions: z.array(TracedValueSchema),
  warnings: z.array(z.object({ code: ScoringWarningCodeSchema, message: z.string() })),
  inputsHash: z.string(),
  computedAt: z.string(),
})
export type ScoringResult = z.infer<typeof ScoringResultSchema>

export const EstimateFlagSchema = z.enum([
  'UNDERPRICED',
  'BELOW_FLOOR',
  'CUSTOM_QUOTE',
  // A bounded band without a floor or ceiling reached the estimate: invalid Config escaped validation.
  'INVALID_BAND_CONFIG',
  'LOW_CONFIDENCE',
  'UNCALIBRATED_PATTERN',
  'EMPTY_SCOPE',
])
export type EstimateFlag = z.infer<typeof EstimateFlagSchema>

export const EstimateResultSchema = z.object({
  calibratedHours: z.number(),
  overheadBreakdown: z.array(z.object({ label: z.string(), hours: z.number() })),
  contingencyHours: z.number(),
  totalHours: z.number(),
  // Null when totalHours is 0 (EMPTY_SCOPE). Placing an empty scope would clamp it up to a band floor.
  bandId: z.string().nullable(),
  indicativePrice: z.number(),
  price: z.number(),
  // price / totalHours. Null when totalHours is 0, where the division has no answer.
  effectiveHourlyRate: z.number().nullable(),
  flags: z.array(EstimateFlagSchema),
  perOpportunity: z.array(
    z.object({
      opportunityId: z.string(),
      rawHours: z.number(),
      multiplier: z.number(),
      trustworthy: z.boolean(),
      calibratedHours: z.number(),
    }),
  ),
  // Cross-check only. Never feeds the price.
  advisoryBlueprintHours: z.number().nullable(),
  inputsHash: z.string(),
  computedAt: z.string(),
})
export type EstimateResult = z.infer<typeof EstimateResultSchema>

export const RunCostResultSchema = z.object({
  perModel: z.record(
    DeliveryModelSchema,
    z.object({
      clientMonthly: z.number(),
      agencyMonthly: z.number(),
      agencyAnnual: z.number(),
      lineItems: z.array(
        z.object({ label: z.string(), monthly: z.number(), paidBy: z.string() }),
      ),
    }),
  ),
  selectedModel: DeliveryModelSchema,
  clientMonthly: z.number(),
  agencyMonthly: z.number(),
  agencyAnnual: z.number(),
  warnings: z.array(z.object({ code: RunCostWarningCodeSchema, message: z.string() })),
  inputsHash: z.string(),
  computedAt: z.string(),
})
export type RunCostResult = z.infer<typeof RunCostResultSchema>

export const ROIResultSchema = z.object({
  scenarios: z.record(
    z.enum(['conservative', 'expected', 'optimistic']),
    z.object({
      grossAnnualValue: z.number(),
      netAnnualBenefit: z.number(),
      // null when the running cost meets or exceeds the value: there is no payback.
      paybackMonths: z.number().nullable(),
      roiYear1: z.number(),
      roiYear3: z.number(),
      npv: z.number(),
    }),
  ),
  hoursSavedPerMonth: z.number(),
  hoursSavedPerYear: z.number(),
  implementationCost: z.number(),
  annualRunCost: z.number(),
  assumptions: z.array(TracedValueSchema),
  lowestConfidence: z.number(),
  warnings: z.array(z.object({ code: ROIWarningCodeSchema, message: z.string() })),
  inputsHash: z.string(),
  computedAt: z.string(),
})
export type ROIResult = z.infer<typeof ROIResultSchema>
