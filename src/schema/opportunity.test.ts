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

  it('requires an integration name that is not blank, since each one is counted and named in the working', () => {
    const inputs = opportunity().effortInputs
    const integrations = [...inputs.integrations, { name: ' ', hasPublicApi: false, authAvailable: false }]
    expect(issuePaths(EffortInputsSchema, { ...inputs, integrations })).toEqual(['integrations.1.name'])
  })

  it('refuses a blank or repeated compliance flag, at the later entry, since each adds effort points', () => {
    const inputs = opportunity().effortInputs
    expect(issuePaths(EffortInputsSchema, { ...inputs, complianceFlags: ['GDPR', '', 'GDPR'] })).toEqual(['complianceFlags.1', 'complianceFlags.2'])
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

  it('requires a title that is not blank, since it names the opportunity everywhere it is ranked', () => {
    expect(issuePaths(OpportunitySchema, { ...opportunity(), title: ' ' })).toEqual(['title'])
  })

  it('refuses a repeated process or pattern, which would count its value or its hours twice', () => {
    const base = opportunity()
    expect(issuePaths(OpportunitySchema, { ...base, processIds: ['proc-1', 'proc-1'] })).toEqual(['processIds'])
    expect(issuePaths(OpportunitySchema, { ...base, patternIds: ['pat-email-triage', 'pat-email-triage'] })).toEqual(['patternIds'])
    expect(OpportunitySchema.safeParse({ ...base, processIds: ['proc-1', 'proc-1'] }).error?.issues[0]?.message).toBe("The process 'proc-1' is linked more than once")
  })

  it('requires the primary pattern to be one of the linked patterns, so estimation calibrates what scoring costed', () => {
    const base = opportunity()
    expect(issuePaths(OpportunitySchema, { ...base, primaryPatternId: 'pat-crm-sync' })).toEqual([])
    expect(issuePaths(OpportunitySchema, { ...base, primaryPatternId: 'pat-invoices' })).toEqual(['primaryPatternId'])
    expect(issuePaths(OpportunitySchema, { ...base, patternIds: [], primaryPatternId: 'pat-email-triage' })).toEqual(['primaryPatternId'])
  })

  it('holds each share to a share of the whole, since scoring divides both by 100', () => {
    const base = opportunity()
    const share = (value: number) => ({ value, unit: 'percent', source: 'estimated' })
    expect(issuePaths(OpportunitySchema, { ...base, automatablePercent: share(100) })).toEqual([])
    expect(issuePaths(OpportunitySchema, { ...base, automatablePercent: share(101) })).toEqual(['automatablePercent.value'])
    expect(issuePaths(OpportunitySchema, { ...base, errorReductionPercent: share(150) })).toEqual(['errorReductionPercent.value'])
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
