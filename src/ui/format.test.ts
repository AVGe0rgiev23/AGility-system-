import { describe, expect, it } from 'vitest'
import { formatNumber, formatTraced, isRounded, localDate } from './format'

describe('formatNumber', () => {
  it('prints money, told by its currency, with exactly two decimals and grouping', () => {
    expect(formatNumber(1200.5, 'EUR')).toBe('1,200.50')
    expect(formatNumber(0, 'GBP')).toBe('0.00')
    expect(formatNumber(1234567.891, 'USD')).toBe('1,234,567.89')
  })

  it('prints other numbers with at most two decimals and no trailing zeros', () => {
    expect(formatNumber(1200.5)).toBe('1,200.5')
    expect(formatNumber(12)).toBe('12')
    expect(formatNumber(33.3333)).toBe('33.33')
    expect(formatNumber(0.125)).toBe('0.13')
  })
})

describe('formatTraced', () => {
  it('prints the value followed by its unit', () => {
    expect(formatTraced({ value: 16, unit: 'EUR/hour', currency: 'EUR', source: 'client-stated' })).toBe('16.00 EUR/hour')
    expect(formatTraced({ value: 4.5, unit: 'hours/week', source: 'estimated' })).toBe('4.5 hours/week')
  })
})

describe('isRounded', () => {
  it('is false when the display shows every digit the number has', () => {
    expect(isRounded(1200.5, 'EUR')).toBe(false)
    expect(isRounded(1234567)).toBe(false)
    expect(isRounded(1e21)).toBe(false)
  })

  it('is true when the display drops digits', () => {
    expect(isRounded(0.125)).toBe(true)
    expect(isRounded(0.1 + 0.2)).toBe(true)
    expect(isRounded(16.005, 'EUR')).toBe(true)
  })
})

describe('localDate', () => {
  it('writes the local calendar date as YYYY-MM-DD', () => {
    expect(localDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
    expect(localDate(new Date(2026, 11, 31, 0, 1))).toBe('2026-12-31')
  })
})
