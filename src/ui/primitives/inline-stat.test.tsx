import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { InlineStat } from './inline-stat'

describe('InlineStat', () => {
  it('shows a captured figure with its unit and source', () => {
    const html = renderToStaticMarkup(
      <InlineStat traced={{ value: 16, unit: 'EUR/hour', currency: 'EUR', source: 'client-stated', note: 'Marta, call 2' }} />,
    )
    expect(html).toContain('>16.00<')
    expect(html).toContain('>EUR/hour<')
    expect(html).toContain('CLIENT*')
    expect(html).toContain('Note: Marta, call 2')
  })

  it('shows a computed figure with its confidence', () => {
    const html = renderToStaticMarkup(<InlineStat value={24000} unit="EUR/year" currency="EUR" confidence={64} />)
    expect(html).toContain('>24,000.00<')
    expect(html).toContain('>EUR/year<')
    expect(html).toContain('CONF 64')
  })

  it('puts the exact value one hover away only when the display rounds it', () => {
    const rounded = renderToStaticMarkup(<InlineStat traced={{ value: 0.125, unit: 'hours', source: 'measured' }} />)
    expect(rounded).toContain('title="Exact value: 0.125"')
    expect(rounded).toContain('>0.13<')

    const exact = renderToStaticMarkup(<InlineStat traced={{ value: 1200.5, unit: 'EUR', currency: 'EUR', source: 'measured' }} />)
    expect(exact).not.toContain('Exact value')
  })

  it('shows a dash and no badge when there is no figure', () => {
    const missing = renderToStaticMarkup(<InlineStat traced={null} />)
    expect(missing).toContain('—')
    expect(missing).toContain('Not captured')
    expect(missing).not.toContain('Source:')

    const none = renderToStaticMarkup(<InlineStat value={null} unit="EUR/hour" currency="EUR" confidence={80} />)
    expect(none).toContain('No figure')
    expect(none).not.toContain('CONF')
  })
})
