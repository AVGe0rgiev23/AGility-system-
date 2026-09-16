import { describe, expect, it } from 'vitest'
import { AMBIGUOUS_NUMBER, dotReadingWarning, NOT_A_NUMBER, VALUE_REQUIRED } from './use-traced-draft'
import { moved, numberWarnings, replaceAt, schemaIssues, textIssues, valueAt, withoutTextsUnder, withTextIssuesFirst } from './form-paths'
import { z } from 'zod'

describe('valueAt and replaceAt', () => {
  const root = { a: { b: [{ c: 1 }, { c: 2 }] }, d: 'x' }

  it('reads through objects and arrays, and reads undefined past a leaf or a missing key', () => {
    expect(valueAt(root, 'a.b.1.c')).toBe(2)
    expect(valueAt(root, 'd')).toBe('x')
    expect(valueAt(root, 'd.length')).toBeUndefined()
    expect(valueAt(root, 'a.z.c')).toBeUndefined()
  })

  it('replaces one value in a copy, leaving the original and its untouched branches as they were', () => {
    const next = replaceAt(root, 'a.b.0.c', 9) as typeof root
    expect(next.a.b[0]?.c).toBe(9)
    expect(root.a.b[0]?.c).toBe(1)
    expect(next.a.b[1]).toBe(root.a.b[1])
  })

  it('removes the key when the replacement is undefined', () => {
    expect(replaceAt(root, 'd', undefined)).toEqual({ a: root.a })
  })
})

describe('typed text issues', () => {
  it('reports text that does not parse, and empty text only where the field has no empty meaning', () => {
    const texts = { 'a.one': 'abc', 'a.two': '1,200', 'a.three': '', 'b.four': '', 'b.five': '12' }
    expect(textIssues(texts, (path) => path.startsWith('b.'))).toEqual([
      { path: 'a.one', message: NOT_A_NUMBER },
      { path: 'a.two', message: AMBIGUOUS_NUMBER },
      { path: 'a.three', message: VALUE_REQUIRED },
    ])
  })

  it('keeps only the text issue at a field whose text does not parse', () => {
    const typed = [{ path: 'x', message: NOT_A_NUMBER }]
    const schema = [
      { path: 'x', message: 'must be above 0' },
      { path: 'y', message: 'must be below 1' },
    ]
    expect(withTextIssuesFirst(typed, schema)).toEqual([typed[0], schema[1]])
  })

  it('warns about a dot before three digits from the text alone', () => {
    expect(numberWarnings('1.125')).toEqual([dotReadingWarning(1.125, 1125)])
    expect(numberWarnings('1.12')).toEqual([])
    expect(numberWarnings('abc')).toEqual([])
  })

  it('turns a Zod error into issues at dotted paths', () => {
    const error = z.object({ list: z.array(z.object({ n: z.number() })) }).safeParse({ list: [{ n: 'x' }] }).error
    expect(schemaIssues(error).map((issue) => issue.path)).toEqual(['list.0.n'])
    expect(schemaIssues(undefined)).toEqual([])
  })
})

describe('list edits', () => {
  it('drops typed text under a list and nowhere else', () => {
    expect(withoutTextsUnder({ 'bands.0.floor': 'x', 'bandsExtra.0': 'y', rate: 'z' }, 'bands')).toEqual({ 'bandsExtra.0': 'y', rate: 'z' })
  })

  it('moves an item one place, and leaves the order alone at either end', () => {
    expect(moved(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c'])
    expect(moved(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b'])
    expect(moved(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c'])
    expect(moved(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c'])
  })
})
