import type { ReactNode } from 'react'

export interface Column<Row> {
  id: string
  header: string
  // Right-aligned monospace, so digits line up down the column.
  numeric?: boolean
  cell: (row: Row) => ReactNode
}

export interface TableProps<Row> {
  // Read by screen readers; the screen's heading already says it visually.
  caption: string
  columns: readonly Column<Row>[]
  rows: readonly Row[]
  rowKey: (row: Row) => string
  empty: string
}

// Every list of records is one of these: dense rows, one rule between them, no cards.
export function Table<Row>({ caption, columns, rows, rowKey, empty }: TableProps<Row>) {
  return (
    <table className="w-full border-collapse text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead className="sticky top-0 bg-bg">
        <tr>
          {columns.map((column) => (
            <th
              key={column.id}
              scope="col"
              className={`h-7 border-b px-2 text-xs font-normal whitespace-nowrap text-muted ${column.numeric === true ? 'text-right' : 'text-left'}`}
            >
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={Math.max(columns.length, 1)} className="h-7 border-b px-2 text-muted">
              {empty}
            </td>
          </tr>
        ) : (
          rows.map((row) => (
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
