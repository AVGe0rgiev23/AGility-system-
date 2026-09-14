import { describe, expect, it } from 'vitest'
import { canonicalJson, hashInputs } from './inputs-hash'
import { mulberry32, randomPlainValue } from './__fixtures__/engine-fixtures'

describe('canonicalJson', () => {
  it('sorts object keys at every depth', () => {
    const value = { b: 1, a: { d: [{ z: 1, y: 2 }], c: 'x' } }
    expect(canonicalJson(value)).toBe('{"a":{"c":"x","d":[{"y":2,"z":1}]},"b":1}')
  })

  it('keeps array order', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]')
  })

  it('drops undefined properties and nulls undefined array items, like JSON.stringify', () => {
    expect(canonicalJson({ a: undefined, b: [undefined, 1] })).toBe('{"b":[null,1]}')
  })

  it('serialises scalars like JSON.stringify', () => {
    expect(canonicalJson(null)).toBe('null')
    expect(canonicalJson(true)).toBe('true')
    expect(canonicalJson('a "quoted" string')).toBe('"a \\"quoted\\" string"')
    expect(canonicalJson(1.5)).toBe('1.5')
    expect(canonicalJson(NaN)).toBe('null')
    expect(canonicalJson(Infinity)).toBe('null')
  })

  it('agrees with JSON.stringify on already-sorted plain data', () => {
    const random = mulberry32(7)
    for (let i = 0; i < 100; i++) {
      const value = randomPlainValue(random)
      expect(JSON.parse(canonicalJson(value))).toEqual(JSON.parse(JSON.stringify(value) ?? 'null'))
    }
  })
})

describe('hashInputs', () => {
  it('returns a fixed-width lowercase hex string', () => {
    expect(hashInputs({ a: 1 })).toMatch(/^[0-9a-f]{14}$/)
    expect(hashInputs(null)).toMatch(/^[0-9a-f]{14}$/)
  })

  it('ignores key order', () => {
    expect(hashInputs({ a: 1, b: { c: 2, d: 3 } })).toBe(hashInputs({ b: { d: 3, c: 2 }, a: 1 }))
  })

  it('changes when any nested value changes', () => {
    const base = { a: 1, b: { c: [1, 2, 3] } }
    expect(hashInputs(base)).not.toBe(hashInputs({ ...base, b: { c: [1, 2, 4] } }))
    expect(hashInputs(base)).not.toBe(hashInputs({ ...base, a: 2 }))
  })

  it('distinguishes types that print alike', () => {
    expect(hashInputs('1')).not.toBe(hashInputs(1))
    expect(hashInputs([1])).not.toBe(hashInputs({ 0: 1 }))
  })

  it('is deterministic for random plain values', () => {
    const random = mulberry32(11)
    for (let i = 0; i < 200; i++) {
      const value = randomPlainValue(random)
      const copy = JSON.parse(JSON.stringify(value) ?? 'null') as unknown
      expect(hashInputs(copy)).toBe(hashInputs(value))
    }
  })
})
