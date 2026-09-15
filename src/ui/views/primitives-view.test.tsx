import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PrimitivesView } from './primitives-view'

describe('PrimitivesView', () => {
  it('renders every primitive', () => {
    const html = renderToStaticMarkup(<PrimitivesView />)
    expect(html).toContain('CONF 49')
    expect(html).toContain('>Annual value<')
    expect(html).toContain('<caption class="sr-only">Sample processes</caption>')
    expect(html).toContain('No engagements yet')
    expect(html).toContain('A company name is required')
    expect(html).toContain('aria-label="Blended hourly cost currency"')
    expect(html).toContain("Stored with unit &#x27;hours&#x27;")
    expect(html).toContain('<caption class="sr-only">The value each TracedInput last emitted</caption>')
  })
})
