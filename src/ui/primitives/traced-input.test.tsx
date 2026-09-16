import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { mulberry32, pick, randomInt, randomNumber, type Random } from '../../engines/__fixtures__/engine-fixtures'
import { parseNumberText } from '../../hooks/use-traced-draft'
import type { Currency, TracedValue } from '../../schema/traced'
import { formatNumber } from '../format'
import { Stat } from './stat'
import { TracedInput } from './traced-input'

const ignore = () => undefined

// The editable value box: the text input whose id ends in -value.
function valueBoxText(html: string): string {
  const input = /<input[^>]*id="[^"]*-value"[^>]*>/.exec(html)?.[0]
  const text = input === undefined ? undefined : / value="([^"]*)"/.exec(input)?.[1]
  if (text === undefined) throw new Error('no value box in the rendered markup')
  return text
}

describe('TracedInput', () => {
  it('offers a currency only on a money field, with the unit after it', () => {
    const money = renderToStaticMarkup(<TracedInput label="Blended hourly cost" value={null} currency="GBP" per="hour" onChange={ignore} />)
    expect(money).toContain('aria-label="Blended hourly cost currency"')
    expect(money.match(/<option value="(EUR|GBP|USD)"/g)).toEqual(['<option value="EUR"', '<option value="GBP"', '<option value="USD"'])
    expect(money).toContain('<option value="GBP" selected="">GBP</option>')
    expect(money).toContain('>/hour</span>')

    const minutes = renderToStaticMarkup(<TracedInput label="Minutes per occurrence" value={null} unit="minutes" required onChange={ignore} />)
    expect(minutes).not.toContain('currency')
    expect(minutes.match(/<select/g)).toHaveLength(1)
    expect(minutes).toContain('>minutes</span>')
  })

  it('offers the four sources behind an unselectable placeholder, and selects none for a new value', () => {
    const html = renderToStaticMarkup(<TracedInput label="Error rate" value={null} unit="percent" onChange={ignore} />)
    expect(html).toContain('<option value="" disabled="" selected="">source</option>')
    for (const source of ['client-stated', 'measured', 'estimated', 'default']) {
      expect(html).toContain(`<option value="${source}">${source}</option>`)
    }
  })

  it('shows a stored value with its currency, source and note', () => {
    const stored: TracedValue = { value: 1234.5, unit: 'USD/hour', currency: 'USD', source: 'measured', note: 'payroll export' }
    const html = renderToStaticMarkup(<TracedInput label="Role hourly cost" value={stored} currency="EUR" per="hour" onChange={ignore} />)
    expect(valueBoxText(html)).toBe('1234.5')
    expect(html).toContain('<option value="USD" selected="">USD</option>')
    expect(html).toContain('<option value="measured" selected="">measured</option>')
    expect(html).toContain('value="payroll export"')
  })

  it('names every control and ties the value box to its label, requirement and description', () => {
    const html = renderToStaticMarkup(<TracedInput label="Occurrences" value={null} unit="count/month" required hint="Per month" onChange={ignore} />)
    const valueId = /<label for="([^"]*)"/.exec(html)?.[1]
    expect(valueId).toMatch(/-value$/)
    expect(html).toContain(`id="${valueId}"`)
    expect(html).toContain(`aria-describedby="${valueId}-description"`)
    expect(html).toContain('aria-required="true"')
    expect(html).toContain('aria-invalid="false"')
    expect(html).toContain('inputMode="decimal"')
    expect(html).toContain('aria-label="Occurrences source"')
    expect(html).toContain('aria-label="Occurrences note"')
    expect(html).toContain('Per month')
  })

  it('writes a form path on the value box only when given one', () => {
    const withPath = renderToStaticMarkup(<TracedInput label="Blended hourly cost" value={null} currency="EUR" per="hour" path="company.blendedHourlyCost" onChange={ignore} />)
    expect(/<input[^>]*id="[^"]*-value"[^>]*>/.exec(withPath)?.[0]).toContain('data-config-path="company.blendedHourlyCost"')
    expect(renderToStaticMarkup(<TracedInput label="Minutes" value={null} unit="minutes" onChange={ignore} />)).not.toContain('data-config-path')
  })

  it('shows no issues before the field has been left, even when a required value is missing', () => {
    const html = renderToStaticMarkup(<TracedInput label="Occurrences" value={null} unit="count/month" required onChange={ignore} />)
    expect(html).not.toContain('role="alert"')
  })

  it('warns inline about a stored number with three decimals that could be read as thousands, and still shows it', () => {
    const stored: TracedValue = { value: 1.125, unit: 'minutes', source: 'measured' }
    const html = renderToStaticMarkup(<TracedInput label="Minutes per occurrence" value={stored} unit="minutes" required onChange={ignore} />)
    expect(valueBoxText(html)).toBe('1.125')
    expect(html).toContain('text-warn">Read as 1.125, not 1125. Use 1125 or 1125.00 if the dot was a thousands separator.<')
    expect(html).toContain('aria-invalid="false"')
  })

  it('warns about a stored unit the field does not record', () => {
    const stored: TracedValue = { value: 2, unit: 'hours', source: 'client-stated' }
    const html = renderToStaticMarkup(<TracedInput label="Minutes per occurrence" value={stored} unit="minutes" required onChange={ignore} />)
    expect(html).toContain("text-warn\">Stored with unit &#x27;hours&#x27;, but this field records &#x27;minutes&#x27;.")
  })
})

// ---- Display and editing never share text ------------------------------------------------------

function randomFigure(random: Random): { value: number; currency: Currency | undefined } {
  const kind = randomInt(random, 0, 3)
  const value =
    kind === 0
      ? randomInt(random, 0, 10_000_000)
      : kind === 1
        ? Number(randomNumber(random, 0, 100_000).toFixed(randomInt(random, 0, 5)))
        : kind === 2
          ? randomNumber(random, 0, 1) * 10 ** randomInt(random, -9, 24)
          : randomNumber(random, 0, 999)
  return { value, currency: random() < 0.5 ? pick(random, ['EUR', 'GBP', 'USD'] as const) : undefined }
}

const FIXED: { value: number; currency: Currency | undefined }[] = [
  { value: 1200.5, currency: 'EUR' },
  { value: 1234567.891, currency: 'GBP' },
  { value: 0.1 + 0.2, currency: undefined },
  { value: 0.125, currency: undefined },
  { value: 1e21, currency: undefined },
  { value: 1234, currency: undefined },
]

function figures(): { value: number; currency: Currency | undefined }[] {
  const random = mulberry32(0xd15a)
  return [...FIXED, ...Array.from({ length: 300 }, () => randomFigure(random))]
}

function traced({ value, currency }: { value: number; currency: Currency | undefined }): TracedValue {
  return currency === undefined ? { value, unit: 'count', source: 'measured' } : { value, unit: `${currency}/hour`, currency, source: 'measured' }
}

describe('display to edit round trip', () => {
  it('shows a grouped, rounded figure in a Stat, and ungrouped text in a TracedInput that reads back to the identical number', () => {
    for (const figure of figures()) {
      const value = traced(figure)
      const stat = renderToStaticMarkup(<Stat label="Figure" traced={value} />)
      expect(stat, String(figure.value)).toContain(`>${formatNumber(figure.value, figure.currency)}<`)

      const input =
        figure.currency === undefined
          ? renderToStaticMarkup(<TracedInput label="Figure" value={value} unit="count" required onChange={ignore} />)
          : renderToStaticMarkup(<TracedInput label="Figure" value={value} currency={figure.currency} per="hour" required onChange={ignore} />)
      const text = valueBoxText(input)
      expect(text, String(figure.value)).toBe(String(figure.value))
      expect(text, String(figure.value)).not.toContain(',')
      const parsed = parseNumberText(text)
      expect(parsed.kind === 'number' && Object.is(parsed.value, figure.value), `${text} reads back as ${JSON.stringify(parsed)}`).toBe(true)
    }
  })

  it('refuses grouped display text pasted into the value box, or reads it within display rounding, never a thousandfold misread', () => {
    expect(parseNumberText(formatNumber(1200.5, 'EUR')).kind).toBe('invalid')
    expect(parseNumberText(formatNumber(1234)).kind).toBe('invalid')
    for (const figure of figures()) {
      const shown = formatNumber(figure.value, figure.currency)
      const parsed = parseNumberText(shown)
      if (parsed.kind === 'number') {
        expect(Math.abs(parsed.value - figure.value), `${shown} for ${String(figure.value)}`).toBeLessThanOrEqual(0.005 + 1e-9)
      } else {
        expect(parsed.kind, shown).toBe('invalid')
      }
    }
  })
})
