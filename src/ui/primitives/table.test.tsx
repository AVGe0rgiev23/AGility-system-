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

  it('is not sortable without onSort, even on a column with a sort value', () => {
    const sortable: Column<Row>[] = [{ id: 'name', header: 'Company', cell: (row) => row.name, sortValue: (row) => row.name }]
    const html = renderToStaticMarkup(<Table caption="Engagements" columns={sortable} rows={[]} rowKey={(row) => row.id} empty="None yet" />)
    expect(html).not.toContain('<button')
    expect(html).not.toContain('aria-sort')
  })

  it('makes a sortable header a button, marks the sorted column, and shows rows in its order', () => {
    const sortable: Column<Row>[] = [
      { id: 'name', header: 'Company', cell: (row) => row.name, sortValue: (row) => row.name },
      { id: 'hours', header: 'Hours', numeric: true, cell: (row) => row.hours, sortValue: (row) => row.hours },
      { id: 'note', header: 'Note', cell: () => '' },
    ]
    const rows: Row[] = [
      { id: 'a', name: 'Rila Logistics', hours: 42 },
      { id: 'b', name: 'Solo Bakery', hours: 7.5 },
      { id: 'c', name: 'Acme', hours: 12 },
    ]
    const html = renderToStaticMarkup(
      <Table caption="Engagements" columns={sortable} rows={rows} rowKey={(row) => row.id} empty="None yet" sort={{ columnId: 'hours', direction: 'descending' }} onSort={() => undefined} />,
    )
    expect(html).toContain('<th scope="col" aria-sort="none"')
    expect(html).toContain('<th scope="col" aria-sort="descending"')
    expect(html.match(/<button type="button"/g)).toHaveLength(2)
    expect(html).toContain('>Hours<span aria-hidden="true" class="num">↓</span></button>')
    expect(html).toContain('<th scope="col" class="h-7 border-b px-2 text-xs font-normal whitespace-nowrap text-muted text-left">Note</th>')
    const order = ['Rila Logistics', 'Acme', 'Solo Bakery'].map((name) => html.indexOf(`>${name}</td>`))
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it('shows rows as given when the sort names a column that cannot sort', () => {
    const rows: Row[] = [
      { id: 'a', name: 'Solo Bakery', hours: 1 },
      { id: 'b', name: 'Acme', hours: 2 },
    ]
    const html = renderToStaticMarkup(
      <Table caption="Engagements" columns={columns} rows={rows} rowKey={(row) => row.id} empty="None yet" sort={{ columnId: 'name', direction: 'ascending' }} onSort={() => undefined} />,
    )
    expect(html.indexOf('>Solo Bakery</td>')).toBeLessThan(html.indexOf('>Acme</td>'))
  })

  it('renders a detail row across every column under its record only, and keeps it with the record when sorted', () => {
    const sortable: Column<Row>[] = [
      { id: 'name', header: 'Company', cell: (row) => row.name },
      { id: 'hours', header: 'Hours', numeric: true, cell: (row) => row.hours, sortValue: (row) => row.hours },
    ]
    const rows: Row[] = [
      { id: 'a', name: 'Rila Logistics', hours: 42 },
      { id: 'b', name: 'Solo Bakery', hours: 7.5 },
    ]
    const html = renderToStaticMarkup(
      <Table
        caption="Engagements"
        columns={sortable}
        rows={rows}
        rowKey={(row) => row.id}
        empty="None yet"
        sort={{ columnId: 'hours', direction: 'ascending' }}
        onSort={() => undefined}
        detail={(row) => (row.id === 'a' ? <p>Working for Rila</p> : null)}
      />,
    )
    expect(html.match(/<p>Working for Rila<\/p>/g)).toHaveLength(1)
    expect(html).toContain('<td colSpan="2" class="border-b bg-surface px-2 py-2"><p>Working for Rila</p></td>')
    // Sorted ascending, Solo comes first, and Rila's detail follows Rila, not the first row.
    expect(html.indexOf('>Solo Bakery</td>')).toBeLessThan(html.indexOf('>Rila Logistics</td>'))
    expect(html.indexOf('>Rila Logistics</td>')).toBeLessThan(html.indexOf('Working for Rila'))
  })

  it('renders no detail row when none is asked for', () => {
    const rows: Row[] = [{ id: 'a', name: 'Rila Logistics', hours: 42 }]
    const html = renderToStaticMarkup(<Table caption="Engagements" columns={columns} rows={rows} rowKey={(row) => row.id} empty="None yet" />)
    expect(html.match(/<tr/g)).toHaveLength(2)
  })

  it('renders cell text containing markup as text', () => {
    const rows: Row[] = [{ id: 'x', name: '<img src=x onerror=alert(1)>', hours: 1 }]
    const html = renderToStaticMarkup(<Table caption="Engagements" columns={columns} rows={rows} rowKey={(row) => row.id} empty="None yet" />)
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })
})
