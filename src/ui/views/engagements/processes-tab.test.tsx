import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { initialProcessDraft, processDraftFromSession, processDraftIssues, type NewProcessDraft } from '../../../hooks/process-rules'
import {
  addProcess,
  engagementFormView,
  initialEngagementForm,
  locatedPaths,
  setText,
  tabOf,
  type EngagementFormState,
} from '../../../hooks/use-engagement-form'
import { businessProcess, discoverySession, engagement, newEngagement, questionSet } from '../../../schema/__fixtures__/records'
import type { Answer, DiscoverySession, Question, QuestionSet } from '../../../schema/discovery'
import type { Process } from '../../../schema/process'
import type { TracedValue } from '../../../schema/traced'
import { describedBy, escapeHtml, renderedPaths, tagFor } from '../../__fixtures__/markup'
import { ProcessEditor } from './process-editor'
import { NewProcessPanel, ProcessesTabScreen, type SessionChoice } from './processes-tab'

const ignore = () => undefined

function renderTab(state: EngagementFormState, panel: React.ReactNode = null): string {
  return renderToStaticMarkup(<ProcessesTabScreen form={engagementFormView(state, ignore)} panel={panel} onNew={ignore} />)
}

function renderPanel(draft: NewProcessDraft, patch: { sessions?: SessionChoice[]; issues?: { path: string; message: string }[] } = {}): string {
  return renderToStaticMarkup(
    <NewProcessPanel
      draft={draft}
      currency="EUR"
      sessions={patch.sessions ?? []}
      issues={patch.issues ?? []}
      onDraft={ignore}
      onSession={ignore}
      onPending={ignore}
      onCreate={ignore}
      onCancel={ignore}
    />,
  )
}

function second(): Process {
  return { ...businessProcess(), id: 'proc-2', name: 'Invoice chasing', owner: 'Accounts' }
}

describe('ProcessesTabScreen', () => {
  it('lists each process with the figures scoring reads, each carrying where it came from', () => {
    const html = renderTab(initialEngagementForm(engagement()))
    expect(html).toContain('Quote request to CRM entry')
    expect(html).toContain('href="#/engagements/eng-1/processes/proc-1"')
    expect(html).toContain('Dispatcher')
    // A figure is never a bare number: each row's three come with their source badge.
    expect(html).toMatch(/120<\/span><span class="num text-muted">count\/month<\/span>/)
    expect(html).toContain('client-stated')
    expect(html).toContain('measured')
  })

  it('counts steps, bottlenecks and pain points, and the opportunities a process is used by', () => {
    const html = renderTab(initialEngagementForm(engagement()))
    // One step, which is a bottleneck; two pain points; one opportunity.
    expect(html).toMatch(/<td[^>]*>1<\/td><td[^>]*>1<\/td><td[^>]*>2<\/td><td[^>]*><span title="1 opportunity is about this process">1<\/span><\/td>/)
  })

  it('will not remove a process an opportunity is about, and says how many', () => {
    const html = renderTab(initialEngagementForm(engagement()))
    expect(html).toContain('title="1 opportunity is about this process"')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Remove<\/button>/)
  })

  it('removes a process nothing uses', () => {
    const html = renderTab(addProcess(initialEngagementForm(engagement()), second()))
    const buttons = html.match(/<button[^>]*aria-label="Remove [^"]*"[^>]*>Remove<\/button>/g) ?? []
    expect(buttons).toHaveLength(2)
    expect(buttons.filter((button) => button.includes('disabled=""'))).toHaveLength(1)
  })

  it('says when there are none, and offers to start one', () => {
    const html = renderTab(initialEngagementForm(newEngagement()))
    expect(html).toContain('No processes yet')
    expect(html).toContain('>New process</button>')
  })

  it('counts a process problem on its row, and names an unnamed process by its place', () => {
    const state = setText(initialEngagementForm(engagement()), 'processes.0.name', '')
    const html = renderTab(state)
    expect(html).toContain('>Process 1</a>')
    expect(html).toContain('class="num text-danger">1</span>')
  })

  it('shows the paths the form model places issues at for one process, between the list and the editor', () => {
    const state = initialEngagementForm(engagement())
    const shown = new Set([
      ...renderedPaths(renderTab(state)),
      ...renderedPaths(renderToStaticMarkup(<ProcessEditor form={engagementFormView(state, ignore)} processId="proc-1" />)),
    ])
    const addressed = [...locatedPaths(state.draft)].filter((path) => tabOf(path) === 'processes' && !path.startsWith('processes.0.id'))
    expect([...shown].sort()).toEqual(addressed.sort())
  })
})

describe('NewProcessPanel', () => {
  it('starts with nothing chosen and nothing filled, so it opens without a refusal', () => {
    const html = renderPanel(initialProcessDraft())
    expect(html).toContain('New process')
    expect(html).toContain('<option value="" disabled="" selected="">choose</option>')
    expect(html).not.toContain('role="alert"')
  })

  it('names each missing required field under its own row once creating has been tried', () => {
    const html = renderPanel(initialProcessDraft(), { issues: processDraftIssues(initialProcessDraft()) })
    expect(describedBy(html, 'name')).toContain(escapeHtml('A process needs a name'))
    expect(html).toContain('How often it runs is needed')
    expect(html).toContain('How long one run takes is needed')
    expect(html).toContain('How many people touch each run is needed')
    expect(describedBy(html, 'revenueImpact')).toContain(escapeHtml('Choose how close this process is to revenue'))
  })

  it('offers only sessions that carry a process answer, and says when none does', () => {
    expect(renderPanel(initialProcessDraft())).toContain('No discovery session has answered a process question yet')
    const html = renderPanel(initialProcessDraft(), { sessions: [{ id: 'sess-1', label: 'Full discovery · 2026-09-18 10:00' }] })
    expect(html).toContain('<option value="sess-1">Full discovery · 2026-09-18 10:00</option>')
    expect(html).toContain('Carries each figure the client gave, with where it came from')
  })

  it('shows the figures a session carried over as editable text, with the source and note they were given', () => {
    const set: QuestionSet = {
      ...questionSet(),
      id: 'qs-process',
      questions: [{ id: 'q-occ', text: 'How often?', kind: 'number', required: false, mapsTo: 'process.frequency.occurrencesPerMonth' } satisfies Question],
    }
    const traced: TracedValue = { value: 90, unit: 'count/month', source: 'client-stated', note: 'Marta: about 90', answerId: 'a-occ', capturedAt: '2026-09-18T10:00:00.000Z' }
    const answer: Answer = { id: 'a-occ', questionId: 'q-occ', kind: 'number', value: 90, traced, followUpTriggered: [], flags: [] }
    const session: DiscoverySession = { ...discoverySession(), id: 'sess-1', questionSetId: 'qs-process', answers: [answer] }
    const draft = processDraftFromSession(session, set)
    const html = renderPanel(draft, { sessions: [{ id: 'sess-1', label: 'From the session' }] })
    expect(html).toContain('<option value="sess-1" selected="">From the session</option>')
    expect(html).toMatch(/value="90"/)
    expect(html).toContain('<option value="client-stated" selected="">client-stated</option>')
    expect(html).toContain('value="Marta: about 90"')
  })

  it('records each figure in the unit its field fixes and bounds the error rate', () => {
    const html = renderPanel(initialProcessDraft())
    expect(html).toContain('>count/month</span>')
    expect(html).toContain('>minutes</span>')
    expect(html).toContain('>percent</span>')
    expect(html).toContain('aria-label="Role hourly cost currency"')
    expect(html).toContain('aria-label="Cost per error currency"')
    expect(tagFor(html, 'occurrencesPerMonth')).toContain('aria-required="true"')
  })
})
