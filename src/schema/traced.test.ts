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
    expect(CurrencySchema.options).toEqual(['EUR', 'GBP', 'USD'])
  })

  it('reject anything else', () => {
    expect(SourceSchema.safeParse('guessed').success).toBe(false)
    expect(CurrencySchema.safeParse('JPY').success).toBe(false)
    expect(CurrencySchema.safeParse('eur').success).toBe(false)
  })

  it('reject BGN, which Bulgaria replaced with the euro', () => {
    expect(CurrencySchema.safeParse('BGN').success).toBe(false)
  })
})

describe('moneyUnitCurrency', () => {
  it('reads the currency from the leading unit segment', () => {
    expect(moneyUnitCurrency('EUR')).toBe('EUR')
    expect(moneyUnitCurrency('USD/hour')).toBe('USD')
    expect(moneyUnitCurrency('GBP/error')).toBe('GBP')
  })

  it('returns null for non-money units', () => {
    expect(moneyUnitCurrency('BGN/hour')).toBeNull()
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
    expect(issuePaths(TracedValueSchema, { ...tracedMoney(), currency: 'GBP' })).toEqual(['currency'])
  })

  it('rejects a currency on a unit that is not money, which the engines would convert at an FX rate', () => {
    expect(issuePaths(TracedValueSchema, { ...tracedHours(), unit: 'percent', currency: 'EUR' })).toEqual(['currency'])
    expect(issuePaths(TracedValueSchema, { value: 40, unit: 'per error', currency: 'GBP', source: 'default' })).toEqual(['currency'])
    expect(issuePaths(TracedValueSchema, { ...tracedHours(), currency: 'USD' })).toEqual(['currency'])
  })

  it('names the currency and the unit when refusing a currency on a unit that is not money', () => {
    const result = TracedValueSchema.safeParse({ value: 5, unit: 'percent', currency: 'EUR', source: 'estimated' })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe("currency 'EUR' is set, but unit 'percent' is not a money unit")
  })

  it('rejects a stored BGN value, as an old export or hand-edited file would contain', () => {
    const stored = { value: 32, unit: 'BGN/hour', currency: 'BGN', source: 'client-stated' }
    expect(issuePaths(TracedValueSchema, roundTrip(stored))).toEqual(['currency'])
  })

  it('rejects an unknown source', () => {
    expect(issuePaths(TracedValueSchema, { ...tracedHours(), source: 'guessed' })).toEqual(['source'])
  })

  it('rejects a negative value', () => {
    expect(issuePaths(TracedValueSchema, { ...tracedHours(), value: -1 })).toEqual(['value'])
    expect(issuePaths(TracedValueSchema, { ...tracedMoney(), value: -0.01 })).toEqual(['value'])
    expect(issuePaths(TracedValueSchema, { ...tracedHours(), value: 0 })).toEqual([])
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
    expectTypeOf<Currency>().toEqualTypeOf<'EUR' | 'GBP' | 'USD'>()
    expectTypeOf<TracedValue['value']>().toEqualTypeOf<number>()
    expectTypeOf<TracedValue['source']>().toEqualTypeOf<Source>()
    expectTypeOf<TracedValue['currency']>().toEqualTypeOf<Currency | undefined>()
  })
})
