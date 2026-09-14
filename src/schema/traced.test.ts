import { describe, expect, expectTypeOf, it } from 'vitest'
import { issuePaths, roundTrip, tracedHours, tracedMoney } from './__fixtures__/records'
import {
  CurrencySchema,
  moneyUnitCurrency,
  SourceSchema,
  TracedValueSchema,
  type Currency,
  type Source,
  type TracedValue,
} from './traced'

describe('Source and Currency', () => {
  it('accept exactly the spec values', () => {
    expect(SourceSchema.options).toEqual(['client-stated', 'measured', 'estimated', 'default'])
    expect(CurrencySchema.options).toEqual(['EUR', 'BGN', 'GBP', 'USD'])
  })

  it('reject anything else', () => {
    expect(SourceSchema.safeParse('guessed').success).toBe(false)
    expect(CurrencySchema.safeParse('JPY').success).toBe(false)
    expect(CurrencySchema.safeParse('eur').success).toBe(false)
  })
})

describe('moneyUnitCurrency', () => {
  it('reads the currency from the leading unit segment', () => {
    expect(moneyUnitCurrency('EUR')).toBe('EUR')
    expect(moneyUnitCurrency('BGN/hour')).toBe('BGN')
    expect(moneyUnitCurrency('GBP/error')).toBe('GBP')
  })

  it('returns null for non-money units', () => {
    expect(moneyUnitCurrency('hours/week')).toBeNull()
    expect(moneyUnitCurrency('percent')).toBeNull()
    expect(moneyUnitCurrency('count')).toBeNull()
    expect(moneyUnitCurrency('per/EUR')).toBeNull()
    expect(moneyUnitCurrency('')).toBeNull()
  })
})

describe('TracedValueSchema', () => {
  it('accepts a non-money value without a currency', () => {
    expect(TracedValueSchema.parse(tracedHours())).toEqual(tracedHours())
  })

  it('accepts a money value whose currency matches its unit', () => {
    expect(TracedValueSchema.parse(tracedMoney())).toEqual(tracedMoney())
  })

  it('requires a currency on money units', () => {
    const { currency: _omitted, ...withoutCurrency } = tracedMoney()
    expect(issuePaths(TracedValueSchema, withoutCurrency)).toEqual(['currency'])
    expect(issuePaths(TracedValueSchema, { ...withoutCurrency, unit: 'EUR' })).toEqual(['currency'])
  })

  it('rejects a currency that contradicts the unit', () => {
    expect(issuePaths(TracedValueSchema, { ...tracedMoney(), currency: 'EUR' })).toEqual(['currency'])
  })

  it('rejects an unknown source', () => {
    expect(issuePaths(TracedValueSchema, { ...tracedHours(), source: 'guessed' })).toEqual(['source'])
  })

  it('rejects non-finite numbers, which JSON cannot carry', () => {
    expect(issuePaths(TracedValueSchema, { ...tracedHours(), value: Infinity })).toEqual(['value'])
    expect(issuePaths(TracedValueSchema, { ...tracedHours(), value: NaN })).toEqual(['value'])
  })

  it('reports a missing unit as an issue instead of throwing in the refinement', () => {
    const { unit: _omitted, ...withoutUnit } = tracedHours()
    expect(issuePaths(TracedValueSchema, withoutUnit)).toEqual(['unit'])
  })

  it('strips unknown keys', () => {
    const parsed = TracedValueSchema.parse({ ...tracedHours(), confidence: 99 })
    expect(parsed).not.toHaveProperty('confidence')
  })

  it('survives a JSON round trip unchanged', () => {
    expect(TracedValueSchema.parse(roundTrip(tracedMoney()))).toEqual(tracedMoney())
  })

  it('infers the spec types', () => {
    expectTypeOf<Source>().toEqualTypeOf<'client-stated' | 'measured' | 'estimated' | 'default'>()
    expectTypeOf<Currency>().toEqualTypeOf<'EUR' | 'BGN' | 'GBP' | 'USD'>()
    expectTypeOf<TracedValue['value']>().toEqualTypeOf<number>()
    expectTypeOf<TracedValue['source']>().toEqualTypeOf<Source>()
    expectTypeOf<TracedValue['currency']>().toEqualTypeOf<Currency | undefined>()
  })
})
