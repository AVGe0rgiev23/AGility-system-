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
  RunCostResultSchema,
  ScoringResultSchema,
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

  it('requires inputsHash and computedAt for the derived-data policy', () => {
    const { inputsHash: _a, computedAt: _b, ...uncached } = scoringResult()
    expect(issuePaths(ScoringResultSchema, uncached)).toEqual(['inputsHash', 'computedAt'])
  })

  it('infers the spec types', () => {
    expectTypeOf<ScoringResult['quadrant']>().toEqualTypeOf<
      'quick-win' | 'strategic' | 'fill-in' | 'avoid'
    >()
    expectTypeOf<ScoringResult['breakdown'][number]['source']>().toEqualTypeOf<Source>()
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
      'LOW_CONFIDENCE',
      'UNCALIBRATED_PATTERN',
    ])
    expect(issuePaths(EstimateResultSchema, { ...estimateResult(), flags: ['OVERPRICED'] })).toEqual([
      'flags.0',
    ])
  })

  it('rejects a non-finite effective hourly rate, as a zero-hour division would produce', () => {
    expect(
      issuePaths(EstimateResultSchema, { ...estimateResult(), effectiveHourlyRate: Infinity }),
    ).toEqual(['effectiveHourlyRate'])
  })

  it('infers the spec types', () => {
    expectTypeOf<EstimateResult['advisoryBlueprintHours']>().toEqualTypeOf<number | null>()
    expectTypeOf<EstimateResult['perOpportunity'][number]['trustworthy']>().toEqualTypeOf<boolean>()
  })
})

describe('RunCostResultSchema', () => {
  it('accepts a full result', () => {
    expect(RunCostResultSchema.parse(runCostResult())).toEqual(runCostResult())
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

  it('requires all three scenarios', () => {
    const result = roiResult()
    const { optimistic: _omitted, ...twoScenarios } = result.scenarios
    expect(issuePaths(ROIResultSchema, { ...result, scenarios: twoScenarios })).toEqual([
      'scenarios.optimistic',
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
  })
})
