import { describe, expect, expectTypeOf, it } from 'vitest'
import { issuePaths, opportunity, roundTrip, scoringResult } from './__fixtures__/records'
import { EffortInputsSchema, OpportunitySchema, type EffortInputs, type Opportunity } from './opportunity'
import type { ScoringResult } from './results'
import type { TracedValue } from './traced'

describe('EffortInputsSchema', () => {
  it('accepts valid inputs', () => {
    expect(EffortInputsSchema.parse(opportunity().effortInputs)).toEqual(opportunity().effortInputs)
  })

  it('rejects values outside each effort factor enum', () => {
    const inputs = opportunity().effortInputs
    expect(issuePaths(EffortInputsSchema, { ...inputs, dataReadiness: 'messy' })).toEqual(['dataReadiness'])
    expect(issuePaths(EffortInputsSchema, { ...inputs, volumeTier: 'extreme' })).toEqual(['volumeTier'])
    expect(issuePaths(EffortInputsSchema, { ...inputs, novelty: 'unknown' })).toEqual(['novelty'])
  })

  it('requires approvalSteps to be a whole number, at least 0', () => {
    const inputs = opportunity().effortInputs
    expect(issuePaths(EffortInputsSchema, { ...inputs, approvalSteps: -1 })).toEqual(['approvalSteps'])
    expect(issuePaths(EffortInputsSchema, { ...inputs, approvalSteps: 1.5 })).toEqual(['approvalSteps'])
    expect(issuePaths(EffortInputsSchema, { ...inputs, approvalSteps: 0 })).toEqual([])
  })

  it('requires both API and auth flags on every integration', () => {
    const inputs = { ...opportunity().effortInputs, integrations: [{ name: 'Xero' }] }
    expect(issuePaths(EffortInputsSchema, inputs)).toEqual([
      'integrations.0.hasPublicApi',
      'integrations.0.authAvailable',
    ])
  })
})

describe('OpportunitySchema', () => {
  it('accepts an unscored opportunity', () => {
    expect(OpportunitySchema.parse(opportunity())).toEqual(opportunity())
  })

  it('accepts a cached scoring result', () => {
    const scored = { ...opportunity(), scoring: scoringResult() }
    expect(OpportunitySchema.parse(scored)).toEqual(scored)
  })

  it('accepts no linked pattern', () => {
    expect(issuePaths(OpportunitySchema, { ...opportunity(), patternIds: [], primaryPatternId: null })).toEqual(
      [],
    )
  })

  it('requires automatablePercent as a traced value', () => {
    expect(issuePaths(OpportunitySchema, { ...opportunity(), automatablePercent: 70 })).toEqual([
      'automatablePercent',
    ])
  })

  it('validates a cached scoring result rather than trusting it', () => {
    const corrupt = { ...opportunity(), scoring: { ...scoringResult(), valueScore: 'high' } }
    expect(issuePaths(OpportunitySchema, corrupt)).toEqual(['scoring.valueScore'])
  })

  it('carries no roi field', () => {
    const parsed = OpportunitySchema.parse({ ...opportunity(), roi: { npv: 1 } })
    expect(parsed).not.toHaveProperty('roi')
  })

  it('carries no selected flag, since the scope alone records what is selected', () => {
    const parsed = OpportunitySchema.parse({ ...opportunity(), selected: true })
    expect(parsed).not.toHaveProperty('selected')
  })

  it('survives a JSON round trip unchanged', () => {
    const scored = { ...opportunity(), scoring: scoringResult() }
    expect(OpportunitySchema.parse(roundTrip(scored))).toEqual(scored)
  })

  it('infers the spec types', () => {
    expectTypeOf<Opportunity['primaryPatternId']>().toEqualTypeOf<string | null>()
    expectTypeOf<Opportunity['automatablePercent']>().toEqualTypeOf<TracedValue>()
    expectTypeOf<Opportunity['scoring']>().toEqualTypeOf<ScoringResult | null>()
    expectTypeOf<Opportunity['effortInputs']>().toEqualTypeOf<EffortInputs>()
    expectTypeOf<EffortInputs['novelty']>().toEqualTypeOf<'known-pattern' | 'similar-pattern' | 'new'>()
  })
})
