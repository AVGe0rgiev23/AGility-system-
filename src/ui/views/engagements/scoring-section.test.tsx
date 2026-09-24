import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { quadrantSummary, rankingFor, type Ranking } from '../../../hooks/opportunity-ranking'
import { engagementFormView, initialEngagementForm, setPending, setTraced, type EngagementFormState } from '../../../hooks/use-engagement-form'
import { defaultConfig } from '../../../schema/config'
import type { Engagement } from '../../../schema/engagement'
import { businessProcess, engagement, opportunity } from '../../../schema/__fixtures__/records'
import { escapeHtml } from '../../__fixtures__/markup'
import { DEFAULT_RANKING_SORT, ScoringSection } from './scoring-section'

const ignore = () => undefined
const NOW = '2026-09-24T12:00:00.000Z'
const PATTERNS = [
  { id: 'pat-email-triage', baseHours: 12 },
  { id: 'pat-crm-sync', baseHours: 8 },
]

// Two opportunities on two processes: 'Quote intake' on the busier one, so it ranks first.
function twoProcesses(): Engagement {
  const record = engagement()
  const quiet = { ...businessProcess(), id: 'proc-2', name: 'Invoice chasing' }
  quiet.frequency = { ...quiet.frequency, occurrencesPerMonth: { value: 10, unit: 'count/month', source: 'client-stated' } }
  return {
    ...record,
    processes: [businessProcess(), quiet],
    opportunities: [
      { ...opportunity(), id: 'opp-1', title: 'Quote intake' },
      { ...opportunity(), id: 'opp-2', title: 'Invoice reminders', processIds: ['proc-2'] },
    ],
  }
}

function rankingOf(state: EngagementFormState): Ranking {
  const form = engagementFormView(state, ignore)
  return rankingFor({ engagement: form.merged(), issues: form.issues, pending: state.pending, patterns: PATTERNS, config: defaultConfig(), now: NOW })
}

function render(ranking: Ranking, patch: { expandedId?: string | null; changed?: boolean } = {}): string {
  return renderToStaticMarkup(
    <ScoringSection engagementId="eng-1" ranking={ranking} expandedId={patch.expandedId ?? null} changed={patch.changed ?? false} sort={DEFAULT_RANKING_SORT} onSort={ignore} />,
  )
}

function order(html: string, titles: readonly string[]): number[] {
  return titles.map((title) => html.indexOf(`>${title}</a>`))
}

describe('ScoringSection', () => {
  it('ranks by priority, highest first, with each figure carrying its confidence', () => {
    const html = render(rankingOf(initialEngagementForm(twoProcesses())))
    const [first, second] = order(html, ['Quote intake', 'Invoice reminders'])
    expect(first).toBeGreaterThan(-1)
    expect(first).toBeLessThan(second ?? -1)
    // Seven figures per row (value, hours saved, build hours, two scores, priority, confidence), each with a CONF badge.
    expect(html.match(/CONF \d+/g)?.length).toBeGreaterThanOrEqual(14)
    expect(html).toContain('EUR/year')
  })

  it('re-ranks as soon as a figure a row reads is edited in the draft, before any Save', () => {
    const state = setTraced(initialEngagementForm(twoProcesses()), 'processes.1.frequency.occurrencesPerMonth', {
      value: 4000,
      unit: 'count/month',
      source: 'client-stated',
    })
    const html = render(rankingOf(state), { changed: true })
    const [quote, invoice] = order(html, ['Quote intake', 'Invoice reminders'])
    expect(invoice).toBeLessThan(quote ?? -1)
    expect(html).toContain('unsaved edits included: Save stores them')
  })

  it('shows a row it cannot score yet as not scored, last, with no dot on the plot', () => {
    const state = setPending(initialEngagementForm(twoProcesses()), 'opportunities.0.automatablePercent', true)
    const ranking = rankingOf(state)
    const html = render(ranking)
    expect(html).toContain('not scored: fix 1 problem')
    const [quote, invoice] = order(html, ['Quote intake', 'Invoice reminders'])
    expect(invoice).toBeLessThan(quote ?? -1)
    expect(html.match(/<circle /g)).toHaveLength(1)
    expect(html).toContain('Not scored: 1.')
  })

  it('opens the working under its row: every term with its source, the four internal ones marked, and the warnings', () => {
    const ranking = rankingOf(initialEngagementForm(twoProcesses()))
    if (ranking.kind !== 'ranked' || ranking.rows[0]?.kind !== 'scored') throw new Error('expected a scored row')
    const { breakdown } = ranking.rows[0].result
    const html = render(ranking, { expandedId: 'opp-1' })
    expect(html).toContain('id="working-opp-1"')
    for (const term of breakdown) expect(html, term.label).toContain(`>${escapeHtml(term.label)}`)
    expect(html.match(/>internal<\/span>/g)).toHaveLength(4)
    // One source badge per term.
    expect(html.match(/title="Source: /g)?.length).toBeGreaterThanOrEqual(breakdown.length)
    expect(html).toContain('href="#/engagements/eng-1/opportunities" aria-expanded="true" aria-controls="working-opp-1"')
    // Only the named row is open.
    expect(html).not.toContain('id="working-opp-2"')
  })

  it('marks low confidence as a warning and lists the warning codes', () => {
    const record = twoProcesses()
    const [first] = record.opportunities
    if (first === undefined) throw new Error('no opportunity')
    // No pattern and every figure a default: confidence falls below 50.
    const weak = {
      ...record,
      opportunities: [{ ...first, patternIds: [], primaryPatternId: null, automatablePercent: { value: 70, unit: 'percent', source: 'default' as const } }],
    }
    const html = render(rankingOf(initialEngagementForm(weak)), { expandedId: 'opp-1' })
    expect(html).toMatch(/<span class="[^"]*text-warn"[^>]*title="Confidence \d+ of 100, below 50/)
    expect(html).toContain('>LOW_CONFIDENCE</span>')
    expect(html).toContain('>NO_PATTERN</span>')
  })

  it('draws the quadrant plot with a label naming every opportunity by quadrant, and each dot titled with its confidence', () => {
    const ranking = rankingOf(initialEngagementForm(twoProcesses()))
    if (ranking.kind !== 'ranked') throw new Error('expected a ranking')
    const html = render(ranking)
    expect(html).toContain(`role="img" aria-label="${escapeHtml(quadrantSummary(ranking.rows))}"`)
    expect(html).toContain('1 Quote intake')
    expect(html).toMatch(/<title>1 Quote intake: value \d+, effort \d+, confidence \d+ of 100<\/title>/)
  })

  it('scores nothing, and says why, when the Config or Library cannot be used', () => {
    const html = render({ kind: 'unavailable', reason: 'the stored Config does not validate.' })
    expect(html).toContain('Nothing is scored: the stored Config does not validate.')
    expect(html).not.toContain('<svg')
  })
})
