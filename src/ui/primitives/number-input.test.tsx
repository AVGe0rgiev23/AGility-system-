import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { NumberInput } from './number-input'

const ignore = () => undefined

function control(html: string): string {
  const input = /<input[^>]*>/.exec(html)?.[0]
  if (input === undefined) throw new Error('no input in the rendered markup')
  return input
}

describe('NumberInput', () => {
  it('shows the raw text with its unit, and carries its Config path', () => {
    const html = renderToStaticMarkup(<NumberInput label="Target hourly rate" path="pricing.targetHourlyRate" text="72,5" unit="EUR/hour" required onText={ignore} />)
    const input = control(html)
    expect(input).toContain('value="72,5"')
    expect(input).toContain('data-config-path="pricing.targetHourlyRate"')
    expect(input).toContain('inputMode="decimal"')
    expect(input).toContain('aria-required="true"')
    expect(input).toContain('aria-invalid="false"')
    expect(html).toContain('>EUR/hour</span>')
    expect(html).toContain('>Target hourly rate<span aria-hidden="true"> *</span></label>')
  })

  it('ties the control to its label and to the hint, warnings and issues written under it', () => {
    const html = renderToStaticMarkup(
      <NumberInput
        label="Testing overhead (20%)"
        path="estimation.overheads.testing"
        text="1.200"
        hint="Added to calibrated hours"
        warnings={['Read as 1.2, not 1200.']}
        issues={['The testing overhead must be at least 0 and below 1']}
        onText={ignore}
      />,
    )
    const input = control(html)
    const id = /id="([^"]+)"/.exec(input)?.[1]
    expect(html).toContain(`<label for="${id}"`)
    expect(input).toContain(`aria-describedby="${id}-description"`)
    expect(input).toContain('aria-invalid="true"')
    expect(input).toContain('border-danger')
    const description = html.slice(html.indexOf(`id="${id}-description"`))
    expect(description).toContain('Added to calibrated hours')
    expect(description).toContain('text-warn">Read as 1.2, not 1200.<')
    expect(description).toContain('<li>The testing overhead must be at least 0 and below 1</li>')
  })

  it('renders an empty box with no unit when none is given', () => {
    const html = renderToStaticMarkup(<NumberInput label="Max hours" path="pricing.bands.2.maxHours" text="" layout="cell" onText={ignore} />)
    expect(control(html)).toContain('value=""')
    expect(html).not.toContain('text-muted">')
    expect(html).toContain('class="sr-only">Max hours</label>')
  })
})
