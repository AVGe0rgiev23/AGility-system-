import type { ReactNode } from 'react'
import { nextSort, sortRows, type SortDirection, type SortState, type SortValue } from '../table-sort'

export interface Column<Row> {
  id: string
  header: string
  // Right-aligned monospace, so digits line up down the column.
  numeric?: boolean
  cell: (row: Row) => ReactNode
  // Makes the column sortable, by this value. Null sorts last in either direction.
  sortValue?: (row: Row) => SortValue
  // The direction a first click sorts in; defaults to ascending.
  firstSortDirection?: SortDirection
}

export interface TableProps<Row> {
  // Read by screen readers; the screen's heading already says it visually.
  caption: string
  columns: readonly Column<Row>[]
  rows: readonly Row[]
  rowKey: (row: Row) => string
  empty: string
  // Sorting is controlled by the screen, so its choice can outlive the table. Without onSort, no
  // header is clickable.
  sort?: SortState | null
  onSort?: (next: SortState) => void
}

// Every list of records is one of these: dense rows, one rule between them, no cards.
export function Table<Row>({ caption, columns, rows, rowKey, empty, sort = null, onSort }: TableProps<Row>) {
  const sortedBy = sort === null ? undefined : columns.find((column) => column.id === sort.columnId)
  const shown = sort === null || sortedBy?.sortValue === undefined ? rows : sortRows(rows, sortedBy.sortValue, sort.direction)

  return (
    <table className="w-full border-collapse text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead className="sticky top-0 bg-bg">
        <tr>
          {columns.map((column) => {
            const sortable = onSort !== undefined && column.sortValue !== undefined
            const active = sortable && sort?.columnId === column.id
            const align = column.numeric === true ? 'text-right' : 'text-left'
            return (
              <th
                key={column.id}
                scope="col"
                aria-sort={active ? sort.direction : sortable ? 'none' : undefined}
                className={`h-7 border-b px-2 text-xs font-normal whitespace-nowrap text-muted ${align}`}
              >
                {sortable ? (
                  <button
                    type="button"
                    onClick={() => onSort(nextSort(sort, column.id, column.firstSortDirection))}
                    className={`inline-flex items-center gap-1 transition-colors hover:text-fg ${active ? 'text-fg' : ''}`}
                  >
                    {column.header}
                    <span aria-hidden="true" className="num">
                      {active ? (sort.direction === 'ascending' ? '↑' : '↓') : ''}
                    </span>
                  </button>
                ) : (
                  column.header
                )}
              </th>
            )
          })}
        </tr>
      </thead>
      <tbody>
        {shown.length === 0 ? (
          <tr>
            <td colSpan={Math.max(columns.length, 1)} className="h-7 border-b px-2 text-muted">
              {empty}
            </td>
          </tr>
        ) : (
          shown.map((row) => (
            <tr key={rowKey(row)} className="hover:bg-surface">
              {columns.map((column) => (
                <td key={column.id} className={`h-7 border-b px-2 ${column.numeric === true ? 'num text-right' : 'text-left'}`}>
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  )
}
