import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { initialOpportunityDraft, opportunityDraftIssues, type NewOpportunityDraft } from '../../../hooks/process-rules'
import { engagementFormView, initialEngagementForm, locatedPaths, setText, tabOf, type EngagementFormState } from '../../../hooks/use-engagement-form'
import { engagement, newEngagement, projectScope } from '../../../schema/__fixtures__/records'
import { describedBy, escapeHtml, renderedPaths, tagFor } from '../../__fixtures__/markup'
import { OpportunityEditor, type PatternChoice } from './opportunity-editor'
import { NewOpportunityPanel, OpportunitiesTabScreen, type ProcessChoice } from './opportunities-tab'

const ignore = () => undefined
const PATTERNS: PatternChoice[] = [
  { id: 'pat-email-triage', name: 'Email triage' },
  { id: 'pat-crm-sync', name: 'CRM sync' },
]

function renderTab(state: EngagementFormState, patterns: PatternChoice[] | null = PATTERNS, panel: React.ReactNode = null): string {
  return renderToStaticMarkup(<OpportunitiesTabScreen form={engagementFormView(state, ignore)} patterns={patterns} scoring={null} panel={panel} onNew={ignore} />)
}

function renderPanel(draft: NewOpportunityDraft, patch: { processes?: ProcessChoice[]; issues?: { path: string; message: string }[] } = {}): string {
  return renderToStaticMarkup(
    <NewOpportunityPanel
      draft={draft}
      currency="EUR"
      processes={patch.processes ?? [{ id: 'proc-1', name: 'Quote request to CRM entry' }]}
      issues={patch.issues ?? []}
      onDraft={ignore}
      onPending={ignore}
      onCreate={ignore}
      onCancel={ignore}
    />,
  )
}

describe('OpportunitiesTabScreen', () => {
  it('lists each opportunity with the processes it is about and the shares it claims, each with its source', () => {
    const html = renderTab(initialEngagementForm(engagement()))
    expect(html).toContain('Automatic quote intake')
    expect(html).toContain('href="#/engagements/eng-1/opportunities/opp-1"')
    expect(html).toContain('Quote request to CRM entry')
    expect(html).toMatch(/70<\/span><span class="num text-muted">percent<\/span>/)
    expect(html).toMatch(/80<\/span><span class="num text-muted">percent<\/span>/)
    // A default-sourced share is flagged as one, not passed off as the client's.
    expect(html).toContain('default')
  })

  it('names the primary pattern by its name, and says so when a process it is about is gone', () => {
    expect(renderTab(initialEngagementForm(engagement()))).toContain('2, primary Email triage')
    expect(renderTab(initialEngagementForm(engagement()), null)).toContain('2, primary pat-email-triage')
    const record = engagement()
    const [held] = record.opportunities
    if (held === undefined) throw new Error('the fixture has no opportunity')
    const stale = initialEngagementForm({ ...record, opportunities: [{ ...held, processIds: ['proc-gone'] }] })
    expect(renderTab(stale)).toContain('missing: proc-gone')
  })

  it('shows the ranking it is given above the capture table', () => {
    const html = renderToStaticMarkup(
      <OpportunitiesTabScreen form={engagementFormView(initialEngagementForm(engagement()), ignore)} patterns={PATTERNS} scoring={<p>the ranking</p>} panel={null} onNew={ignore} />,
    )
    expect(html.indexOf('the ranking')).toBeLessThan(html.indexOf('What could be automated'))
    expect(html).not.toContain('Scoring is built in Stage 2, task 10.')
  })

  it('will not remove an opportunity the scope is pricing, since the scope is the only record of that', () => {
    const scoped = initialEngagementForm({ ...engagement(), scope: { ...projectScope(), selectedOpportunityIds: ['opp-1'] } })
    const html = renderTab(scoped)
    expect(html).toContain('title="This opportunity is in the scope being priced"')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Remove<\/button>/)
  })

  it('removes an opportunity that is not in the scope', () => {
    const free = initialEngagementForm({ ...engagement(), scope: { ...projectScope(), selectedOpportunityIds: [] } })
    const html = renderTab(free)
    expect(html).toContain(`aria-label="${escapeHtml("Remove 'Automatic quote intake'")}">Remove</button>`)
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Remove<\/button>/)
  })

  it('says when there are none, and offers to start one', () => {
    const html = renderTab(initialEngagementForm(newEngagement()))
    expect(html).toContain('No opportunities yet')
    expect(html).toContain('>New opportunity</button>')
  })

  it('counts an opportunity problem on its row, and names an untitled one by its place', () => {
    const html = renderTab(setText(initialEngagementForm(engagement()), 'opportunities.0.title', ''))
    expect(html).toContain('>Opportunity 1</a>')
    expect(html).toContain('class="num text-danger">1</span>')
  })

  it('shows the paths the form model places issues at for one opportunity, between the list and the editor', () => {
    const state = initialEngagementForm(engagement())
    const shown = new Set([
      ...renderedPaths(renderTab(state)),
      ...renderedPaths(renderToStaticMarkup(<OpportunityEditor form={engagementFormView(state, ignore)} opportunityId="opp-1" patterns={PATTERNS} />)),
    ])
    const addressed = [...locatedPaths(state.draft)].filter((path) => tabOf(path) === 'opportunities' && !path.startsWith('opportunities.0.id'))
    expect([...shown].sort()).toEqual(addressed.sort())
  })
})

describe('NewOpportunityPanel', () => {
  it('starts with nothing chosen and nothing filled, so it opens without a refusal', () => {
    const html = renderPanel(initialOpportunityDraft())
    expect(html).toContain('New opportunity')
    expect((html.match(/<option value="" disabled="" selected="">choose<\/option>/g) ?? []).length).toBe(3)
    expect(html).not.toContain('role="alert"')
  })

  it('names each missing required field under its own row once creating has been tried', () => {
    const html = renderPanel(initialOpportunityDraft(), { issues: opportunityDraftIssues(initialOpportunityDraft()) })
    expect(describedBy(html, 'title')).toContain(escapeHtml('An opportunity needs a title'))
    expect(html).toContain('An opportunity is about at least one process')
    expect(html).toContain('How much of the work can be automated is needed')
    expect(html).toContain('How much of the error rate it removes is needed')
    expect(describedBy(html, 'dataReadiness')).toContain(escapeHtml('Choose how ready the data is'))
    expect(describedBy(html, 'volumeTier')).toContain(escapeHtml('Choose the volume tier'))
    expect(describedBy(html, 'novelty')).toContain(escapeHtml('Choose how novel this build is'))
  })

  it('offers the engagement processes to tick, and says when there are none to tick', () => {
    expect(renderPanel(initialOpportunityDraft())).toMatch(/<input type="checkbox"\/>Quote request to CRM entry/)
    expect(renderPanel(initialOpportunityDraft(), { processes: [] })).toContain('This engagement has no processes yet. Map one on the Processes tab first.')
    const chosen = renderPanel({ ...initialOpportunityDraft(), processIds: ['proc-1'] })
    expect(chosen).toMatch(/<input type="checkbox" checked=""\/>Quote request to CRM entry/)
  })

  it('records both shares in percent, marked required, and says where the rest is set', () => {
    const html = renderPanel(initialOpportunityDraft())
    expect(html).toContain('>percent</span>')
    expect(tagFor(html, 'automatablePercent')).toContain('aria-required="true"')
    expect(tagFor(html, 'errorReductionPercent')).toContain('aria-required="true"')
    expect(html).toContain('Approval steps, integrations and compliance flags are set in the editor once it exists.')
  })

  it('offers each effort factor with the choices the schema has', () => {
    const html = renderPanel(initialOpportunityDraft())
    for (const option of ['structured', 'semi-structured', 'unstructured', 'low', 'medium', 'high', 'known-pattern', 'similar-pattern', 'new']) {
      expect(html, option).toContain(`<option value="${option}">${option}</option>`)
    }
  })
})
