import { describe, expect, it } from 'vitest'
import { fmt } from './format'

describe('fmt', () => {
  it('strips trailing zeros, down to a whole number', () => {
    expect(fmt(1.5)).toBe('1.5')
    expect(fmt(1.1)).toBe('1.1')
    expect(fmt(2)).toBe('2')
    expect(fmt(100)).toBe('100')
    expect(fmt(0)).toBe('0')
  })

  it('keeps the sign on negatives', () => {
    expect(fmt(-2.5)).toBe('-2.5')
    expect(fmt(-7)).toBe('-7')
    expect(fmt(-3.456)).toBe('-3.46')
  })

  it('prints negative zero, and a negative that rounds to zero, as a plain 0', () => {
    expect(fmt(-0)).toBe('0')
    expect(fmt(-0.001)).toBe('0')
    expect(fmt(-0.004)).toBe('0')
  })

  it('rounds to two decimals, halves away from zero', () => {
    expect(fmt(3.14159)).toBe('3.14')
    expect(fmt(123456789.987)).toBe('123456789.99')
    // 0.125 is exact in binary, so it is a true half.
    expect(fmt(0.125)).toBe('0.13')
    expect(fmt(-0.125)).toBe('-0.13')
  })

  it('rounds the binary value, so a decimal that sits just below a half rounds down', () => {
    // 1.005 is stored as 1.00499999…, and 2.675 as 2.67499999….
    expect(fmt(1.005)).toBe('1')
    expect(fmt(2.675)).toBe('2.67')
  })

  it('prints every digit below 1e21 and switches to exponent notation at 1e21', () => {
    // toFixed gives up on fixed notation from 1e21, so formulas show such figures as exponents.
    expect(fmt(1e20)).toBe('100000000000000000000')
    expect(fmt(999999999999999900000)).toBe('999999999999999900000')
    expect(fmt(1e21)).toBe('1e+21')
    expect(fmt(-1e21)).toBe('-1e+21')
    expect(fmt(1.5e21)).toBe('1.5e+21')
  })
})
