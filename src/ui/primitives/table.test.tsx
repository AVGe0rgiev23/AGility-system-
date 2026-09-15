import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Table, type Column } from './table'

interface Row {
  id: string
  name: string
  hours: number
}

const columns: Column<Row>[] = [
  { id: 'name', header: 'Company', cell: (row) => row.name },
  { id: 'hours', header: 'Hours', numeric: true, cell: (row) => row.hours },
]

describe('Table', () => {
  it('captions the table and scopes its headers to columns', () => {
    const html = renderToStaticMarkup(<Table caption="Engagements" columns={columns} rows={[]} rowKey={(row) => row.id} empty="None yet" />)
    expect(html).toContain('<caption class="sr-only">Engagements</caption>')
    expect(html.match(/<th scope="col"/g)).toHaveLength(2)
  })

  it('renders one row per record, with numeric columns right-aligned in monospace', () => {
    const rows: Row[] = [
      { id: 'a', name: 'Rila Logistics', hours: 42 },
      { id: 'b', name: 'Solo Bakery', hours: 7.5 },
    ]
    const html = renderToStaticMarkup(<Table caption="Engagements" columns={columns} rows={rows} rowKey={(row) => row.id} empty="None yet" />)
    expect(html.match(/<tr class="hover:bg-surface">/g)).toHaveLength(2)
    expect(html).toContain('>Rila Logistics</td>')
    expect(html).toContain('<td class="h-7 border-b px-2 num text-right">7.5</td>')
    expect(html).toContain('text-right">Hours</th>')
    expect(html).not.toContain('None yet')
  })

  it('shows the empty message across every column when there are no rows', () => {
    const html = renderToStaticMarkup(<Table caption="Engagements" columns={columns} rows={[]} rowKey={(row) => row.id} empty="None yet" />)
    expect(html).toContain('colSpan="2"')
    expect(html).toContain('None yet')
  })

  it('renders cell text containing markup as text', () => {
    const rows: Row[] = [{ id: 'x', name: '<img src=x onerror=alert(1)>', hours: 1 }]
    const html = renderToStaticMarkup(<Table caption="Engagements" columns={columns} rows={rows} rowKey={(row) => row.id} empty="None yet" />)
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })
})
