import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { addToList, engagementFormView, initialEngagementForm, locatedPaths, setPending, setText, tabOf, type EngagementFormState } from '../../../hooks/use-engagement-form'
import type { BootedStore } from '../../../hooks/use-store'
import { defaultConfig } from '../../../schema/config'
import { engagement, newEngagement, wholeStore } from '../../../schema/__fixtures__/records'
import { describedBy, escapeHtml, renderedPaths, tagFor } from '../../__fixtures__/markup'
import { EngagementNotFound, EngagementScreen, EngagementView, ENGAGEMENT_TABS } from './engagement-view'
import type { Deletion } from './overview-tab'

const ignore = () => undefined

const NO_DELETION: Deletion = { confirming: false, deleting: false, error: null, onAsk: ignore, onConfirm: ignore, onCancel: ignore }

const PATTERNS = [
  { id: 'pat-email-triage', name: 'Email triage', baseHours: 12 },
  { id: 'pat-crm-sync', name: 'CRM sync', baseHours: 8 },
]

function render(
  state: EngagementFormState,
  tab: string | null = null,
  patch: { saving?: boolean; saveError?: string | null; deletion?: Deletion; item?: string | null } = {},
): string {
  return renderToStaticMarkup(
    <EngagementScreen
      form={engagementFormView(state, ignore)}
      tab={tab}
      saving={patch.saving ?? false}
      saveError={patch.saveError ?? null}
      onSave={ignore}
      deletion={patch.deletion ?? NO_DELETION}
      item={patch.item ?? null}
      questionSets={[]}
      patterns={PATTERNS}
      config={defaultConfig()}
      now="2026-09-24T12:00:00.000Z"
      industries={['Professional Services', 'logistics']}
    />,
  )
}

describe('EngagementScreen, scoring address', () => {
  it("opens the Opportunities tab with the named opportunity's working showing", () => {
    const html = render(initialEngagementForm(engagement()), 'scoring', { item: 'opp-1' })
    expect(html).toMatch(/<a href="#\/engagements\/eng-1\/opportunities" aria-current="page"/)
    expect(html).not.toContain('href="#/engagements/eng-1/scoring"')
    expect(html).toContain('id="working-opp-1"')
    expect(html).toContain('aria-expanded="true"')
    // Collapsing is going back to the tab's own address.
    expect(html).toContain('href="#/engagements/eng-1/opportunities" aria-expanded="true"')
  })

  it('shows the tab with nothing open when no opportunity is named', () => {
    const html = render(initialEngagementForm(engagement()), 'scoring')
    expect(html).toContain('Ranking')
    expect(html).not.toContain('id="working-')
    expect(html).toContain('href="#/engagements/eng-1/scoring/opp-1" aria-expanded="false"')
  })

  it('says so when the named opportunity does not exist, with a way back', () => {
    const html = render(initialEngagementForm(engagement()), 'scoring', { item: 'opp-gone' })
    expect(html).toContain('This engagement has no opportunity <span class="num">opp-gone</span> to show the working for.')
    expect(html).not.toContain('id="working-')
  })

  it('still opens the editor at the opportunities address', () => {
    const html = render(initialEngagementForm(engagement()), 'opportunities', { item: 'opp-1' })
    expect(html).not.toContain('Ranking')
  })
})

describe('EngagementScreen, shell', () => {
  it('heads the page with the company and its stage, and links every section, marking the one open', () => {
    const html = render(initialEngagementForm(engagement()))
    expect(html).toContain('Rila Logistics <span class="num text-xs text-muted">IMPLEMENTATION</span>')
    for (const tab of ENGAGEMENT_TABS) expect(html, tab.id).toContain(`href="#/engagements/eng-1/${tab.id}"`)
    expect(html).toMatch(/<a href="#\/engagements\/eng-1\/overview" aria-current="page"/)
    expect(render(initialEngagementForm(engagement()), 'blueprints')).toContain('The blueprint editor and its diagram are built in Stage 4, tasks 1 and 2.')
  })

  it('names the task that builds each section not built yet', () => {
    for (const tab of ENGAGEMENT_TABS.filter((candidate) => candidate.placeholder !== undefined)) {
      const html = render(initialEngagementForm(engagement()), tab.id)
      expect(html, tab.id).toContain(escapeHtml(tab.placeholder ?? ''))
      expect(html, tab.id).toMatch(new RegExp(`<a href="#/engagements/eng-1/${tab.id}" aria-current="page"`))
    }
  })

  it('says when a section does not exist, with a way to the overview', () => {
    const html = render(initialEngagementForm(engagement()), 'invoices')
    expect(html).toContain('This engagement has no section <span class="num">invoices</span>.')
    expect(html).toContain('href="#/engagements/eng-1"')
  })

  it('counts problems on each tab label, and counts a pending traced field in the save bar', () => {
    let state = setText(initialEngagementForm(engagement()), 'nextAction.text', '')
    state = setText(state, 'nextAction.due', '')
    state = addToList(state, 'tags')
    state = setPending(state, 'company.blendedHourlyCost', true)
    const html = render(state)
    expect(html).toMatch(/Overview<span class="num text-danger" title="1 problem on this tab"> 1<\/span>/)
    expect(html).toContain('Unsaved changes: 2 problems to fix before saving')
    expect(html).toMatch(/<button type="button" class="[^"]*" disabled="">Save<\/button>/)
  })

  it('reports a save that failed', () => {
    expect(render(setText(initialEngagementForm(engagement()), 'source', 'referral'), null, { saveError: 'the database is closed' })).toContain(
      'The engagement was not saved: the database is closed',
    )
  })
})

describe('OverviewTab', () => {
  it('renders exactly the overview paths the form model places issues at', () => {
    const state = addToList(initialEngagementForm(engagement()), 'tags')
    const overview = [...locatedPaths(state.draft)].filter((path) => tabOf(path) === 'overview').sort()
    expect([...renderedPaths(render(state))].sort()).toEqual(overview)
  })

  it('writes each overview issue under its own field', () => {
    let state = setText(initialEngagementForm(engagement()), 'nextAction.text', ' ')
    state = setText(state, 'nextAction.due', '2026-02-30')
    state = addToList(state, 'tags')
    state = setText(state, 'tags.1', 'logistics')
    const html = render(state)
    expect(describedBy(html, 'nextAction.text')).toContain('<li>A next action needs text</li>')
    expect(describedBy(html, 'nextAction.due')).toContain(`<li>${escapeHtml("'2026-02-30' is not a calendar date written as YYYY-MM-DD")}</li>`)
    expect(describedBy(html, 'tags.1')).toContain(`<li>${escapeHtml("The tag 'logistics' is already used")}</li>`)
  })

  it('shows the stage, when it was created and updated, and every stage history entry', () => {
    const html = render(initialEngagementForm(engagement()))
    expect(html).toContain('<span class="num">IMPLEMENTATION</span>')
    expect(html).toContain('<span class="num">2026-09-01T08:00:00.000Z</span>')
    expect(html).toContain('>Signed the SOW</td>')
    expect(html.match(/<span class="num">(LEAD|WON|IMPLEMENTATION)<\/span><\/td>/g)).toHaveLength(3)
    expect(tagFor(html, 'nextAction.due')).toContain('type="date"')
    expect(tagFor(html, 'nextAction.due')).toContain('value="2026-09-18"')
  })

  it('asks before deleting, naming the company and what happens to its folder', () => {
    expect(render(initialEngagementForm(engagement()))).toContain('>Delete engagement…</button>')
    const confirming = render(initialEngagementForm(engagement()), null, { deletion: { ...NO_DELETION, confirming: true } })
    expect(confirming).toContain('Delete Rila Logistics? The engagement is removed from this browser')
    expect(confirming).toContain('listed as a stale folder for you to delete by hand')
    expect(confirming).toContain('>Delete Rila Logistics</button>')
    const failed = render(initialEngagementForm(engagement()), null, { deletion: { ...NO_DELETION, confirming: true, deleting: false, error: 'blocked' } })
    expect(failed).toContain('The engagement was not deleted: blocked')
    expect(render(initialEngagementForm(engagement()), null, { deletion: { ...NO_DELETION, confirming: true, deleting: true } })).toContain('disabled="">Deleting…</button>')
  })
})

describe('EngagementView', () => {
  function loaded(problems: Extract<BootedStore, { phase: 'loaded' }>['load']['problems'] = []): Extract<BootedStore, { phase: 'loaded' }> {
    const store = { ...wholeStore(), engagements: [newEngagement()] }
    return { phase: 'loaded', load: { status: 'loaded', store, problems, seeded: false, migratedFrom: null, recomputed: [], recomputeSkipped: false }, sync: { kind: 'unsupported' }, syncError: null }
  }
  const handle = { saveEngagement: () => Promise.resolve({ ok: true as const }), deleteEngagement: () => Promise.resolve({ ok: true as const }) }

  it('opens a stored engagement', () => {
    expect(renderToStaticMarkup(<EngagementView loaded={loaded()} id="eng-2" tab={null} item={null} handle={handle} />)).toContain('Solo Bakery')
  })

  it('says there is no such engagement, or that it is stored but does not validate', () => {
    expect(renderToStaticMarkup(<EngagementView loaded={loaded()} id="eng-9" tab={null} item={null} handle={handle} />)).toContain('There is no engagement <span class="num">eng-9</span>.')
    const problem = { table: 'engagements' as const, key: 'eng-9', message: 'does not validate', issues: [] }
    expect(renderToStaticMarkup(<EngagementView loaded={loaded([problem])} id="eng-9" tab={null} item={null} handle={handle} />)).toContain('is stored but does not validate')
    expect(renderToStaticMarkup(<EngagementNotFound id="x" storedButInvalid={false} />)).toContain('href="#/engagements"')
  })
})
