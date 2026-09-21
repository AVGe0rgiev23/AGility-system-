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

  it('requires an action that is not blank, since a step is read by what it does', () => {
    expect(issuePaths(ProcessStepSchema, { ...processStep(), action: '  ' })).toEqual(['action'])
  })

  it('refuses a blank system, since absent is the empty value', () => {
    expect(issuePaths(ProcessStepSchema, { ...processStep(), system: ' ' })).toEqual(['system'])
    const { system: _omitted, ...noSystem } = processStep()
    expect(issuePaths(ProcessStepSchema, noSystem)).toEqual([])
  })

  it('accepts a wait time of zero but never a negative one', () => {
    expect(issuePaths(ProcessStepSchema, { ...processStep(), waitTimeMinutes: 0 })).toEqual([])
    expect(issuePaths(ProcessStepSchema, { ...processStep(), waitTimeMinutes: -1 })).toEqual(['waitTimeMinutes'])
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

  it('requires a name that is not blank, since every table and document names the process', () => {
    expect(issuePaths(ProcessSchema, { ...businessProcess(), name: ' ' })).toEqual(['name'])
  })

  it('reports a step rule at the step it belongs to', () => {
    const input = businessProcess()
    const steps = [processStep(), { ...processStep(), id: 'step-2', action: '' }]
    expect(issuePaths(ProcessSchema, { ...input, steps })).toEqual(['steps.1.action'])
  })

  it('refuses a blank or repeated system and pain point, at the later entry', () => {
    const base = businessProcess()
    expect(issuePaths(ProcessSchema, { ...base, systemsTouched: ['Gmail', ' ', 'Gmail'] })).toEqual(['systemsTouched.1', 'systemsTouched.2'])
    expect(issuePaths(ProcessSchema, { ...base, painPoints: ['Retyping', '', 'Retyping'] })).toEqual(['painPoints.1', 'painPoints.2'])
    expect(ProcessSchema.safeParse({ ...base, systemsTouched: ['Gmail', 'Gmail'] }).error?.issues[0]?.message).toBe("The system 'Gmail' is already listed")
  })

  it('holds an error rate to a share of the runs, since scoring reads it as a percentage', () => {
    const input = businessProcess()
    const rated = (value: number) => ({ ...input, errorProfile: { ...input.errorProfile, errorRatePercent: { value, unit: 'percent', source: 'estimated' } } })
    expect(issuePaths(ProcessSchema, rated(100))).toEqual([])
    expect(issuePaths(ProcessSchema, rated(101))).toEqual(['errorProfile.errorRatePercent.value'])
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
