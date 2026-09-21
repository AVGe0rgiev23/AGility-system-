import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { newSession } from '../../../hooks/discovery-rules'
import {
  addSession,
  engagementFormView,
  initialEngagementForm,
  locatedPaths,
  setAnswerTraced,
  setAnswerValue,
  setText,
  tabOf,
  toggleAnswerFlag,
  type EngagementFormState,
} from '../../../hooks/use-engagement-form'
import { newEngagement } from '../../../schema/__fixtures__/records'
import type { Question, QuestionSet } from '../../../schema/discovery'
import { DISCOVERY_SET_ID, seedQuestionSets, TEARDOWN_SET_ID } from '../../../schema/seed-question-sets'
import type { TracedValue } from '../../../schema/traced'
import { describedBy, escapeHtml, renderedPaths, tagFor } from '../../__fixtures__/markup'
import { DiscoveryTabScreen } from './discovery-tab'
import { SessionRunner } from './session-runner'

const ignore = () => undefined
const sets = seedQuestionSets()
const HELD_AT = '2026-09-18T09:00:00.000Z'

function setNamed(id: string): QuestionSet {
  const found = sets.find((candidate) => candidate.id === id)
  if (found === undefined) throw new Error(`no seeded set ${id}`)
  return found
}

function question(id: string): Question {
  const found = setNamed(DISCOVERY_SET_ID).questions.find((candidate) => candidate.id === id)
  if (found === undefined) throw new Error(`no question ${id}`)
  return found
}

function started(): EngagementFormState {
  return addSession(initialEngagementForm(newEngagement()), newSession('ds-1', setNamed(DISCOVERY_SET_ID), HELD_AT, ['Marta Ivanova']))
}

function render(state: EngagementFormState, patch: { sessionId?: string; questionSets?: QuestionSet[] | null } = {}): string {
  return renderToStaticMarkup(
    <SessionRunner form={engagementFormView(state, ignore)} sessionId={patch.sessionId ?? 'ds-1'} questionSets={patch.questionSets === undefined ? sets : patch.questionSets} />,
  )
}

describe('SessionRunner, every field', () => {
  it('shows every path the form model addresses on a session, between the runner and the sessions table', () => {
    let state = setAnswerValue(started(), sets, 0, question('fd-business'), 'Freight forwarding', 'ans-1')
    state = setAnswerValue(state, sets, 0, question('fd-tools'), ['HubSpot'], 'ans-2')
    const shown = new Set([
      ...renderedPaths(render(state)),
      ...renderedPaths(renderToStaticMarkup(<DiscoveryTabScreen form={engagementFormView(state, ignore)} questionSets={sets} panel={null} onNew={ignore} />)),
    ])
    const addressed = [...locatedPaths(state.draft)].filter((path) => tabOf(path) === 'discovery')
    expect([...shown].sort()).toEqual(addressed.sort())
  })
})

describe('SessionRunner, asking', () => {
  it('heads the session with what is being run and how complete it is', () => {
    const html = render(setAnswerValue(started(), sets, 0, question('fd-business'), 'Freight forwarding', 'ans-1'))
    expect(html).toContain('href="#/engagements/eng-2/discovery"')
    expect(html).toContain('<h2 class="text-sm font-medium">Full discovery</h2>')
    expect(html).toContain('of <span class="num">24</span> required answered')
    expect(html).toContain('Running <span class="num">Full discovery</span>')
    expect(tagFor(html, 'discovery.0.heldAt')).toContain('type="datetime-local"')
    expect(html).toContain('<input type="checkbox" checked=""/>Marta Ivanova')
  })

  it('asks each visible question in order, with its help text, kind and required marker', () => {
    const html = render(started())
    expect(html.indexOf('What does the business do, and who are its customers?')).toBeLessThan(html.indexOf('Which industry is it in?'))
    expect(html).toContain('Everyone on the payroll, part-time included.')
    expect(html).toContain('<span class="num text-xs text-muted">boolean</span>')
    expect(html).toContain('<span aria-hidden="true"> *</span>')
  })

  it('gives each kind its own control', () => {
    const state = setAnswerValue(started(), sets, 0, question('fd-business'), 'Freight forwarding', 'ans-1')
    const html = render(state)
    expect(tagFor(html, 'discovery.0.answers.0')).toContain('type="text"')
    expect(tagFor(html, 'discovery.0.answers.0')).toContain('value="Freight forwarding"')
    // A question nobody has answered yet carries no path, because there is no answer to address.
    expect(html).toContain('<option value="" selected="">not answered</option>')
    expect(html).toContain('<input type="radio" name=')
    expect(html).toContain('<input type="checkbox"/>HubSpot')
  })

  it('takes a figure through the traced control, and names what it replaces', () => {
    const traced: TracedValue = { value: 21.5, unit: 'EUR/hour', currency: 'EUR', source: 'client-stated', note: 'about 21.50 all in' }
    const html = render(setAnswerTraced(started(), sets, 0, question('fd-hourly-cost'), traced, 'ans-cost'))
    expect(tagFor(html, 'discovery.0.answers.0')).toContain('inputMode="decimal"')
    expect(tagFor(html, 'discovery.0.answers.0')).toContain('value="21.5"')
    expect(html).toContain('<span class="num">company.blendedHourlyCost</span>, now <span class="num">21.50 EUR/hour</span>')
  })

  it('says a process answer is recorded, and that a process started from the session carries it over', () => {
    const html = render(started())
    expect(html).toContain(escapeHtml('Recorded for '))
    expect(html).toContain('It is carried over when a process is started from this session, on the')
    expect(html).toContain('<a href="#/engagements/')
    expect(html).toContain('/processes" class="text-fg underline">Processes tab</a>')
  })

  it('offers the flags on every question, and a way to unsay an answer', () => {
    const state = toggleAnswerFlag(started(), sets, 0, question('fd-business'), 'pain', true, 'ans-flag')
    const html = render(state)
    expect(html).toContain('<input type="checkbox" checked=""/>pain')
    expect(html).toContain('>blocker</label>')
    expect(html).toContain('>Clear answer</button>')
    expect(render(started())).not.toContain('>Clear answer</button>')
  })

  it('keeps the notes said alongside the answers', () => {
    const html = render(setText(started(), 'discovery.0.rawNotes', 'Wants it before peak season.'))
    expect(tagFor(html, 'discovery.0.rawNotes')).toMatch(/^<textarea /)
    expect(html).toContain('Wants it before peak season.</textarea>')
    expect(html).toContain('Anything said that no question asks for.')
  })
})

describe('SessionRunner, branching', () => {
  it('hides what an answer rules out, counts it, and keeps what was said under it', () => {
    let state = setAnswerValue(started(), sets, 0, question('fd-errors'), true, 'ans-1')
    state = setAnswerValue(state, sets, 0, question('fd-error-example'), 'A missed customs window', 'ans-2')
    expect(render(state)).toContain('Describe the last time it went wrong.')

    const closed = setAnswerValue(state, sets, 0, question('fd-errors'), false, 'ans-3')
    const html = render(closed)
    expect(html).not.toContain('Out of every 100 runs, how many go wrong?')
    expect(html).toContain('questions are hidden by the answers so far')
    expect(html).toContain('Describe the last time it went wrong. — <span class="num">A missed customs window</span>, kept')
  })
})

describe('SessionRunner, problems and gaps', () => {
  it('writes an answer’s refusal on its own row', () => {
    const state = setAnswerValue(started(), sets, 0, question('fd-tools'), ['HubSpot', 'HubSpot'], 'ans-dupe')
    expect(describedBy(render(state), 'discovery.0.answers.0')).toContain(escapeHtml("'HubSpot' is already chosen"))
  })

  it('keeps what was said when the question set has gone, listed by question id', () => {
    const state = setAnswerValue(started(), sets, 0, question('fd-business'), 'Freight forwarding', 'ans-1')
    const html = render(state, { questionSets: [setNamed(TEARDOWN_SET_ID)] })
    expect(html).toContain(`The question set <span class="num">${DISCOVERY_SET_ID}</span> is no longer in the Library`)
    expect(html).toContain('<span class="num text-xs text-muted">fd-business</span> — <span class="num">Freight forwarding</span>')
    expect(html).not.toContain('What does the business do, and who are its customers?')
  })

  it('says when the session addressed is not in this engagement', () => {
    const html = render(started(), { sessionId: 'ds-9' })
    expect(html).toContain('This engagement has no session <span class="num">ds-9</span>.')
    expect(html).toContain('href="#/engagements/eng-2/discovery"')
  })
})
