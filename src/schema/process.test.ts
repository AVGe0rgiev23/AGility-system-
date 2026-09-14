import { describe, expect, expectTypeOf, it } from 'vitest'
import { businessProcess, issuePaths, processStep, roundTrip, tracedMoney } from './__fixtures__/records'
import { ProcessSchema, ProcessStepSchema, type Process } from './process'
import type { TracedValue } from './traced'

describe('ProcessStepSchema', () => {
  it('accepts a valid step', () => {
    expect(ProcessStepSchema.parse(processStep())).toEqual(processStep())
  })

  it('requires the manual and bottleneck flags', () => {
    const { isManual: _a, isBottleneck: _b, ...noFlags } = processStep()
    expect(issuePaths(ProcessStepSchema, noFlags)).toEqual(['isManual', 'isBottleneck'])
  })
})

describe('ProcessSchema', () => {
  it('accepts a full process', () => {
    expect(ProcessSchema.parse(businessProcess())).toEqual(businessProcess())
  })

  it('accepts a role-specific hourly cost override', () => {
    expect(issuePaths(ProcessSchema, { ...businessProcess(), roleHourlyCost: tracedMoney() })).toEqual([])
  })

  it('requires every frequency input as a traced value, not a bare number', () => {
    const input = businessProcess()
    const bare = { ...input, frequency: { ...input.frequency, peopleInvolved: 2 } }
    expect(issuePaths(ProcessSchema, bare)).toEqual(['frequency.peopleInvolved'])
  })

  it('accepts null error inputs, since error value is optional', () => {
    const input = { ...businessProcess(), errorProfile: { errorRatePercent: null, costPerError: null } }
    expect(issuePaths(ProcessSchema, input)).toEqual([])
  })

  it('applies the money-unit currency rule to costPerError', () => {
    const input = businessProcess()
    const costPerError = { value: 40, unit: 'EUR', source: 'estimated' }
    const invalid = { ...input, errorProfile: { ...input.errorProfile, costPerError } }
    expect(issuePaths(ProcessSchema, invalid)).toEqual(['errorProfile.costPerError.currency'])
  })

  it('rejects an unknown revenue impact', () => {
    expect(issuePaths(ProcessSchema, { ...businessProcess(), revenueImpact: 'high' })).toEqual([
      'revenueImpact',
    ])
  })

  it('survives a JSON round trip unchanged', () => {
    expect(ProcessSchema.parse(roundTrip(businessProcess()))).toEqual(businessProcess())
  })

  it('infers the spec types', () => {
    expectTypeOf<Process['frequency']['occurrencesPerMonth']>().toEqualTypeOf<TracedValue>()
    expectTypeOf<Process['roleHourlyCost']>().toEqualTypeOf<TracedValue | null>()
    expectTypeOf<Process['errorProfile']['costPerError']>().toEqualTypeOf<TracedValue | null>()
    expectTypeOf<Process['revenueImpact']>().toEqualTypeOf<'direct' | 'indirect' | 'none'>()
  })
})
