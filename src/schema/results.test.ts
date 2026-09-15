import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  estimateResult,
  issuePaths,
  roiResult,
  roundTrip,
  runCostResult,
  scoringResult,
} from './__fixtures__/records'
import type { DeliveryModel } from './company'
import {
  EstimateFlagSchema,
  EstimateResultSchema,
  ROIResultSchema,
  ROIWarningCodeSchema,
  RunCostResultSchema,
  RunCostWarningCodeSchema,
  ScoringResultSchema,
  ScoringWarningCodeSchema,
  type EstimateResult,
  type ROIResult,
  type RunCostResult,
  type ScoringResult,
} from './results'
import type { Source, TracedValue } from './traced'

describe('ScoringResultSchema', () => {
  it('accepts a full result', () => {
    expect(ScoringResultSchema.parse(scoringResult())).toEqual(scoringResult())
  })

  it('rejects an unknown quadrant', () => {
    expect(issuePaths(ScoringResultSchema, { ...scoringResult(), quadrant: 'moonshot' })).toEqual([
      'quadrant',
    ])
  })

  it('validates each breakdown source', () => {
    const result = scoringResult()
    const breakdown = [{ ...result.breakdown[0], source: 'hunch' }]
    expect(issuePaths(ScoringResultSchema, { ...result, breakdown })).toEqual(['breakdown.0.source'])
  })

  it('defaults a breakdown row with no audience to client, and accepts no audience but client or internal', () => {
    const [row] = scoringResult().breakdown
    if (row === undefined) throw new Error('fixture has a breakdown row')
    const { audience: _omitted, ...withoutAudience } = row
    expect(ScoringResultSchema.parse({ ...scoringResult(), breakdown: [withoutAudience] }).breakdown[0]?.audience).toBe('client')
    expect(issuePaths(ScoringResultSchema, { ...scoringResult(), breakdown: [{ ...row, audience: 'internal' }] })).toEqual([])
    expect(issuePaths(ScoringResultSchema, { ...scoringResult(), breakdown: [{ ...row, audience: 'public' }] })).toEqual([
      'breakdown.0.audience',
    ])
  })

  it('holds warnings as code and message objects, never bare strings', () => {
    const warning = { code: 'NO_PATTERN', message: 'No linked pattern' }
    expect(issuePaths(ScoringResultSchema, { ...scoringResult(), warnings: [warning] })).toEqual([])
    expect(issuePaths(ScoringResultSchema, { ...scoringResult(), warnings: ['NO_PATTERN: No linked pattern'] })).toEqual([
      'warnings.0',
    ])
  })

  it('accepts only the scoring warning codes', () => {
    expect(ScoringWarningCodeSchema.options).toEqual([
      'MISSING_PROCESS',
      'MISSING_PATTERN',
      'NO_PROCESSES',
      'NO_HOURLY_COST',
      'NON_HOURLY_COST_UNIT',
      'NO_PATTERN',
      'LOW_CONFIDENCE',
    ])
    const warnings = [{ code: 'RETAINER_NOT_SET', message: 'belongs to run cost' }]
    expect(issuePaths(ScoringResultSchema, { ...scoringResult(), warnings })).toEqual(['warnings.0.code'])
  })

  it('requires inputsHash and computedAt for the derived-data policy', () => {
    const { inputsHash: _a, computedAt: _b, ...uncached } = scoringResult()
    expect(issuePaths(ScoringResultSchema, uncached)).toEqual(['inputsHash', 'computedAt'])
  })

  it('infers the spec types', () => {
    expectTypeOf<ScoringResult['quadrant']>().toEqualTypeOf<
      'quick-win' | 'strategic' | 'fill-in' | 'avoid'
    >()
    expectTypeOf<ScoringResult['breakdown'][number]['source']>().toEqualTypeOf<Source>()
    expectTypeOf<ScoringResult['breakdown'][number]['audience']>().toEqualTypeOf<'client' | 'internal'>()
    expectTypeOf<ScoringResult['assumptions']>().toEqualTypeOf<TracedValue[]>()
  })
})

describe('EstimateResultSchema', () => {
  it('accepts a full result', () => {
    expect(EstimateResultSchema.parse(estimateResult())).toEqual(estimateResult())
  })

  it('accepts every documented flag and nothing else', () => {
    expect(EstimateFlagSchema.options).toEqual([
      'UNDERPRICED',
      'BELOW_FLOOR',
      'CUSTOM_QUOTE',
      'INVALID_BAND_CONFIG',
      'LOW_CONFIDENCE',
      'UNCALIBRATED_PATTERN',
      'EMPTY_SCOPE',
    ])
    expect(issuePaths(EstimateResultSchema, { ...estimateResult(), flags: ['OVERPRICED'] })).toEqual([
      'flags.0',
    ])
  })

  it('accepts an empty-scope result with no band and no effective hourly rate', () => {
    const empty = {
      ...estimateResult(),
      calibratedHours: 0,
      overheadBreakdown: [],
      contingencyHours: 0,
      totalHours: 0,
      bandId: null,
      indicativePrice: 0,
      price: 0,
      effectiveHourlyRate: null,
      flags: ['EMPTY_SCOPE'],
      perOpportunity: [],
    }
    expect(EstimateResultSchema.parse(empty)).toEqual(empty)
  })

  it('requires bandId and effectiveHourlyRate to be present, even as null', () => {
    const { bandId: _a, effectiveHourlyRate: _b, ...withoutBoth } = estimateResult()
    expect(issuePaths(EstimateResultSchema, withoutBoth)).toEqual(['bandId', 'effectiveHourlyRate'])
  })

  it('rejects a non-finite effective hourly rate, as an unguarded zero-hour division would produce', () => {
    expect(
      issuePaths(EstimateResultSchema, { ...estimateResult(), effectiveHourlyRate: Infinity }),
    ).toEqual(['effectiveHourlyRate'])
  })

  it('infers the spec types', () => {
    expectTypeOf<EstimateResult['bandId']>().toEqualTypeOf<string | null>()
    expectTypeOf<EstimateResult['effectiveHourlyRate']>().toEqualTypeOf<number | null>()
    expectTypeOf<EstimateResult['advisoryBlueprintHours']>().toEqualTypeOf<number | null>()
    expectTypeOf<EstimateResult['perOpportunity'][number]['trustworthy']>().toEqualTypeOf<boolean>()
  })
})

describe('RunCostResultSchema', () => {
  it('accepts a full result', () => {
    expect(RunCostResultSchema.parse(runCostResult())).toEqual(runCostResult())
  })

  it('accepts only the run-cost warning codes, as objects', () => {
    expect(RunCostWarningCodeSchema.options).toEqual([
      'MISSING_USAGE_FORMULA',
      'AGENCY_COST_UNDER_CLIENT_OWNED',
      'RETAINER_MARGIN_THIN',
      'RETAINER_NOT_SET',
    ])
    expect(issuePaths(RunCostResultSchema, { ...runCostResult(), warnings: ['RETAINER_NOT_SET: no retainer'] })).toEqual([
      'warnings.0',
    ])
    const warnings = [{ code: 'NO_PAYBACK', message: 'belongs to ROI' }]
    expect(issuePaths(RunCostResultSchema, { ...runCostResult(), warnings })).toEqual(['warnings.0.code'])
  })

  it('requires a row for every delivery model', () => {
    const result = runCostResult()
    const { hybrid: _omitted, ...twoModels } = result.perModel
    expect(issuePaths(RunCostResultSchema, { ...result, perModel: twoModels })).toEqual([
      'perModel.hybrid',
    ])
  })

  it('infers the spec types', () => {
    expectTypeOf<keyof RunCostResult['perModel']>().toEqualTypeOf<DeliveryModel>()
    expectTypeOf<RunCostResult['selectedModel']>().toEqualTypeOf<DeliveryModel>()
  })
})

describe('ROIResultSchema', () => {
  it('accepts a full result, including a null payback', () => {
    expect(ROIResultSchema.parse(roiResult())).toEqual(roiResult())
  })

  it('accepts only the ROI warning codes, as objects', () => {
    expect(ROIWarningCodeSchema.options).toEqual([
      'EMPTY_SCOPE',
      'NO_IMPLEMENTATION_COST',
      'NO_PAYBACK',
      'PAYBACK_TOO_LONG',
      'LOW_CONFIDENCE',
      'RUN_COST_EATS_CASE',
      'DEFAULT_COST',
    ])
    expect(issuePaths(ROIResultSchema, { ...roiResult(), warnings: ['NO_PAYBACK: stop'] })).toEqual(['warnings.0'])
    const warnings = [{ code: 'DEFAULT_HOURLY_COST', message: 'renamed to DEFAULT_COST' }]
    expect(issuePaths(ROIResultSchema, { ...roiResult(), warnings })).toEqual(['warnings.0.code'])
  })

  it('requires all three scenarios', () => {
    const result = roiResult()
    const { optimistic: _omitted, ...twoScenarios } = result.scenarios
    expect(issuePaths(ROIResultSchema, { ...result, scenarios: twoScenarios })).toEqual([
      'scenarios.optimistic',
    ])
  })

  it('accepts null return ratios and payback, as a zero-price estimate produces', () => {
    const result = roiResult()
    const unpriced = { ...result.scenarios.expected, paybackMonths: null, roiYear1: null, roiYear3: null }
    const scenarios = { conservative: unpriced, expected: unpriced, optimistic: unpriced }
    expect(issuePaths(ROIResultSchema, { ...result, scenarios })).toEqual([])
    const { roiYear1: _omitted, ...withoutRatio } = result.scenarios.expected
    expect(issuePaths(ROIResultSchema, { ...result, scenarios: { ...result.scenarios, expected: withoutRatio } })).toEqual([
      'scenarios.expected.roiYear1',
    ])
  })

  it('survives a JSON round trip unchanged', () => {
    expect(ROIResultSchema.parse(roundTrip(roiResult()))).toEqual(roiResult())
  })

  it('infers the spec types', () => {
    expectTypeOf<keyof ROIResult['scenarios']>().toEqualTypeOf<
      'conservative' | 'expected' | 'optimistic'
    >()
    expectTypeOf<ROIResult['scenarios']['conservative']['paybackMonths']>().toEqualTypeOf<
      number | null
    >()
    expectTypeOf<ROIResult['scenarios']['conservative']['roiYear1']>().toEqualTypeOf<number | null>()
    expectTypeOf<ROIResult['scenarios']['conservative']['roiYear3']>().toEqualTypeOf<number | null>()
  })
})
