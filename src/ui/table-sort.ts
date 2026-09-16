// Sorting for Table, as pure functions. Display only: it orders the rows a table shows and never
// changes the records.

export type SortDirection = 'ascending' | 'descending'

export interface SortState {
  columnId: string
  direction: SortDirection
}

// What a column sorts by. Null is a missing value, which sorts last whichever way the column runs, so
// an empty due date never sits above a real one.
export type SortValue = string | number | null

const TEXT = new Intl.Collator('en-GB', { sensitivity: 'base', numeric: true })

// Numbers before text, should a column ever mix them, so the order is total.
function compareValues(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'number') return -1
  if (typeof b === 'number') return 1
  return TEXT.compare(a, b)
}

// Stable: rows that compare equal keep the order they came in.
export function sortRows<Row>(rows: readonly Row[], sortValue: (row: Row) => SortValue, direction: SortDirection): Row[] {
  const sign = direction === 'ascending' ? 1 : -1
  return rows
    .map((row, index) => ({ row, index, value: sortValue(row) }))
    .sort((a, b) => {
      if (a.value === null || b.value === null) {
        if (a.value === b.value) return a.index - b.index
        return a.value === null ? 1 : -1
      }
      return sign * compareValues(a.value, b.value) || a.index - b.index
    })
    .map(({ row }) => row)
}

// A click on the column already sorted turns it round; a click on another column sorts by it, starting
// in the direction that column reads best first, such as newest first for a date.
export function nextSort(current: SortState | null, columnId: string, firstDirection: SortDirection = 'ascending'): SortState {
  if (current?.columnId !== columnId) return { columnId, direction: firstDirection }
  return { columnId, direction: current.direction === 'ascending' ? 'descending' : 'ascending' }
}
