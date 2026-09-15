import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Stat } from './stat'

describe('Stat', () => {
  it('labels a captured figure and keeps its source', () => {
    const html = renderToStaticMarkup(
      <Stat label="Blended hourly cost" traced={{ value: 32.5, unit: 'GBP/hour', currency: 'GBP', source: 'estimated' }} />,
    )
    expect(html).toContain('aria-label="Blended hourly cost"')
    expect(html).toContain('>Blended hourly cost<')
    expect(html).toContain('>32.50<')
    expect(html).toContain('>GBP/hour<')
    expect(html).toContain('Source: estimated')
  })

  it('labels a computed figure and keeps its confidence', () => {
    const html = renderToStaticMarkup(<Stat label="Annual value" value={18250.4} unit="EUR/year" currency="EUR" confidence={41} />)
    expect(html).toContain('>18,250.40<')
    expect(html).toContain('CONF 41')
  })

  it('labels a missing figure', () => {
    const html = renderToStaticMarkup(<Stat label="Effective hourly rate" value={null} unit="EUR/hour" currency="EUR" confidence={70} />)
    expect(html).toContain('>Effective hourly rate<')
    expect(html).toContain('No figure')
  })
})
