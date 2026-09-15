import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LOW_CONFIDENCE_THRESHOLD } from '../../engines/scoring'
import { ConfidenceBadge } from './confidence-badge'

describe('ConfidenceBadge with a source', () => {
  it('always shows the source as a visible code, with the full source for hover and screen readers', () => {
    const cases = [
      ['client-stated', 'CLIENT'],
      ['measured', 'MEASURED'],
      ['estimated', 'EST'],
      ['default', 'DEFAULT'],
    ] as const
    for (const [source, code] of cases) {
      const html = renderToStaticMarkup(<ConfidenceBadge source={source} />)
      expect(html).toContain(`<span aria-hidden="true">${code}</span>`)
      expect(html).toContain(`title="Source: ${source}"`)
      expect(html).toContain(`<span class="sr-only">Source: ${source}</span>`)
    }
  })

  it('puts the note one hover away and marks that one exists', () => {
    const html = renderToStaticMarkup(<ConfidenceBadge source="client-stated" note="about 4 hours, most weeks" />)
    expect(html).toContain('CLIENT*')
    expect(html).toContain('title="Source: client-stated. Note: about 4 hours, most weeks"')
  })

  it('ignores a note that is only whitespace', () => {
    const html = renderToStaticMarkup(<ConfidenceBadge source="measured" note="  " />)
    expect(html).not.toContain('MEASURED*')
    expect(html).toContain('title="Source: measured"')
  })

  it('shows a default source in the warning colour', () => {
    expect(renderToStaticMarkup(<ConfidenceBadge source="default" />)).toContain('text-warn')
    expect(renderToStaticMarkup(<ConfidenceBadge source="client-stated" />)).not.toContain('text-warn')
  })

  it('renders a note containing markup as text', () => {
    const html = renderToStaticMarkup(<ConfidenceBadge source="estimated" note="<script>alert(1)</script>" />)
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

describe('ConfidenceBadge with a confidence', () => {
  it('shows the score, and says when it is below the proposal threshold', () => {
    const low = renderToStaticMarkup(<ConfidenceBadge confidence={LOW_CONFIDENCE_THRESHOLD - 1} />)
    expect(low).toContain(`CONF ${LOW_CONFIDENCE_THRESHOLD - 1}`)
    expect(low).toContain(`below ${LOW_CONFIDENCE_THRESHOLD}`)
    expect(low).toContain('text-warn')

    const enough = renderToStaticMarkup(<ConfidenceBadge confidence={LOW_CONFIDENCE_THRESHOLD} />)
    expect(enough).not.toContain('below')
    expect(enough).not.toContain('text-warn')
  })
})
