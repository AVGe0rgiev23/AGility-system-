import { describe, expect, it } from 'vitest'
import { mulberry32, pick, randomInt } from '../engines/__fixtures__/engine-fixtures'
import { nextSort, sortRows, type SortValue } from './table-sort'

interface Row {
  id: string
  value: SortValue
}

const ids = (rows: readonly Row[]) => rows.map((row) => row.id)
const byValue = (row: Row) => row.value

describe('sortRows', () => {
  it('sorts numbers numerically and text by en-GB collation, ignoring case and reading digits as numbers', () => {
    const numbers: Row[] = [
      { id: 'a', value: 10 },
      { id: 'b', value: 9 },
      { id: 'c', value: -1.5 },
    ]
    expect(ids(sortRows(numbers, byValue, 'ascending'))).toEqual(['c', 'b', 'a'])
    expect(ids(sortRows(numbers, byValue, 'descending'))).toEqual(['a', 'b', 'c'])

    const text: Row[] = [
      { id: 'a', value: 'solo bakery' },
      { id: 'b', value: 'Rila Logistics' },
      { id: 'c', value: 'item 10' },
      { id: 'd', value: 'item 9' },
    ]
    expect(ids(sortRows(text, byValue, 'ascending'))).toEqual(['d', 'c', 'b', 'a'])
  })

  it('puts missing values last in either direction', () => {
    const rows: Row[] = [
      { id: 'none-1', value: null },
      { id: 'late', value: '2026-10-01' },
      { id: 'none-2', value: null },
      { id: 'early', value: '2026-09-18' },
    ]
    expect(ids(sortRows(rows, byValue, 'ascending'))).toEqual(['early', 'late', 'none-1', 'none-2'])
    expect(ids(sortRows(rows, byValue, 'descending'))).toEqual(['late', 'early', 'none-1', 'none-2'])
  })

  it('keeps rows that compare equal in the order they came in, in both directions', () => {
    const rows: Row[] = [
      { id: 'first', value: 'LEAD' },
      { id: 'other', value: 'AAA' },
      { id: 'second', value: 'lead' },
      { id: 'third', value: 'LEAD' },
    ]
    expect(ids(sortRows(rows, byValue, 'ascending'))).toEqual(['other', 'first', 'second', 'third'])
    expect(ids(sortRows(rows, byValue, 'descending'))).toEqual(['first', 'second', 'third', 'other'])
  })

  it('never changes the input and returns every row exactly once, for any values', () => {
    const random = mulberry32(0x5047)
    for (let trial = 0; trial < 200; trial++) {
      const rows: Row[] = Array.from({ length: randomInt(random, 0, 12) }, (_, index) => ({
        id: `r${index}`,
        value: pick(random, [null, 'a', 'B', 'c', 1, 2, 3] as const),
      }))
      const before = rows.map((row) => ({ ...row }))
      const sorted = sortRows(rows, byValue, pick(random, ['ascending', 'descending'] as const))
      expect(rows).toEqual(before)
      expect([...ids(sorted)].sort()).toEqual([...ids(rows)].sort())
      const firstNull = sorted.findIndex((row) => row.value === null)
      if (firstNull >= 0) expect(sorted.slice(firstNull).every((row) => row.value === null)).toBe(true)
    }
  })
})

describe('nextSort', () => {
  it('starts a new column in its first direction and turns the active column round', () => {
    expect(nextSort(null, 'company')).toEqual({ columnId: 'company', direction: 'ascending' })
    expect(nextSort(null, 'updated', 'descending')).toEqual({ columnId: 'updated', direction: 'descending' })
    expect(nextSort({ columnId: 'updated', direction: 'descending' }, 'updated', 'descending')).toEqual({ columnId: 'updated', direction: 'ascending' })
    expect(nextSort({ columnId: 'company', direction: 'ascending' }, 'company')).toEqual({ columnId: 'company', direction: 'descending' })
    expect(nextSort({ columnId: 'company', direction: 'descending' }, 'stage')).toEqual({ columnId: 'stage', direction: 'ascending' })
  })
})
