import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { newSession } from '../../../hooks/discovery-rules'
import { addSession, engagementFormView, initialEngagementForm, locatedPaths, setAnswerValue, tabOf, type EngagementFormState } from '../../../hooks/use-engagement-form'
import { newEngagement } from '../../../schema/__fixtures__/records'
import type { QuestionSet } from '../../../schema/discovery'
import { DISCOVERY_SET_ID, seedQuestionSets, TEARDOWN_SET_ID } from '../../../schema/seed-question-sets'
import { renderedPaths, tagFor } from '../../__fixtures__/markup'
import { DiscoveryTabScreen, initialNewSession, NewSessionForm, orderedSets, type NewSessionDraft } from './discovery-tab'

const ignore = () => undefined
const sets = seedQuestionSets()
const HELD_AT = '2026-09-18T09:00:00.000Z'

function setNamed(id: string): QuestionSet {
  const found = sets.find((candidate) => candidate.id === id)
  if (found === undefined) throw new Error(`no seeded set ${id}`)
  return found
}

function question(id: string) {
  const found = setNamed(DISCOVERY_SET_ID).questions.find((candidate) => candidate.id === id)
  if (found === undefined) throw new Error(`no question ${id}`)
  return found
}

function started(): EngagementFormState {
  return addSession(initialEngagementForm(newEngagement()), newSession('ds-1', setNamed(DISCOVERY_SET_ID), HELD_AT, ['Marta Ivanova']))
}

function render(state: EngagementFormState, patch: { questionSets?: QuestionSet[] | null; panel?: React.ReactNode } = {}): string {
  return renderToStaticMarkup(
    <DiscoveryTabScreen form={engagementFormView(state, ignore)} questionSets={patch.questionSets === undefined ? sets : patch.questionSets} panel={patch.panel ?? null} onNew={ignore} />,
  )
}

describe('DiscoveryTabScreen', () => {
  it('places issues only where the session itself is addressed; the answers are shown in the runner', () => {
    const state = started()
    const discovery = [...locatedPaths(state.draft)].filter((path) => tabOf(path) === 'discovery')
    expect(renderedPaths(render(state))).toEqual(['discovery'])
    // The rest of the session is addressed here but shown in the runner, which the row links to.
    expect(discovery).toContain('discovery.0.rawNotes')
    expect(render(state)).toContain('href="#/engagements/eng-2/discovery/ds-1"')
  })

  it('lists a session with its set, kind, when it was held, how complete it is and how many answers it has', () => {
    const answered = setAnswerValue(started(), sets, 0, question('fd-business'), 'Freight forwarding', 'ans-1')
    const html = render(answered)
    expect(html).toContain('>Full discovery</a>')
    expect(html).toContain('<span class="num">discovery</span>')
    expect(html).toContain(`title="${HELD_AT}"`)
    expect(html).toMatch(/<td class="h-7 border-b px-2 num text-right">1<\/td>/)
  })

  it('names a set that is no longer in the Library, and keeps the completeness it had', () => {
    const html = render(started(), { questionSets: [setNamed(TEARDOWN_SET_ID)] })
    expect(html).toContain(`>Set ${DISCOVERY_SET_ID}</a>`)
    expect(html).toContain('The question set is gone, so this is what it was when last answered')
  })

  it('counts an answer’s problems on its session’s row, since they are fixed in the runner', () => {
    const state = setAnswerValue(started(), sets, 0, question('fd-tools'), ['HubSpot', 'HubSpot'], 'ans-dupe')
    expect(render(state)).toContain('<span class="num text-danger">1</span>')
    expect(render(started())).toContain('<span class="text-muted">—</span>')
  })

  it('says when no set can be run, and when the Library is unusable', () => {
    expect(render(started(), { questionSets: [] })).toContain('The Library has no question sets yet.')
    expect(render(started(), { questionSets: [] })).toContain('href="#/question-sets"')
    expect(render(started(), { questionSets: null })).toContain('The stored Library is unusable, so no question set can be run.')
  })

  it('offers a new session, and says when there are none', () => {
    const html = render(initialEngagementForm(newEngagement()))
    expect(html).toContain('>New session</button>')
    expect(html).toContain('No sessions yet')
  })
})

describe('NewSessionForm', () => {
  const form = () => engagementFormView(initialEngagementForm(newEngagement()), ignore)
  const suitedOnly: QuestionSet = { ...setNamed(TEARDOWN_SET_ID), appliesTo: { minEmployees: 500 } }

  function renderPanel(draft: NewSessionDraft, patch: { sets?: QuestionSet[]; contacts?: string[]; issue?: string | null } = {}): string {
    return renderToStaticMarkup(
      <NewSessionForm
        draft={draft}
        sets={orderedSets(patch.sets ?? sets, form())}
        contacts={patch.contacts ?? ['Marta Ivanova']}
        issue={patch.issue ?? null}
        onDraft={ignore}
        onStart={ignore}
        onCancel={ignore}
      />,
    )
  }

  it('starts on the first set that suits the company, held now', () => {
    const draft = initialNewSession([suitedOnly, setNamed(DISCOVERY_SET_ID)], form(), new Date(2026, 8, 18, 9, 5))
    expect(draft).toEqual({ questionSetId: DISCOVERY_SET_ID, heldAt: '2026-09-18T09:05', attendees: [] })
    expect(orderedSets([suitedOnly, setNamed(DISCOVERY_SET_ID)], form()).map(({ set }) => set.id)).toEqual([DISCOVERY_SET_ID, TEARDOWN_SET_ID])
  })

  it('groups the sets that suit this company above the rest, and says so', () => {
    const html = renderPanel({ questionSetId: DISCOVERY_SET_ID, heldAt: '2026-09-18T09:05', attendees: [] }, { sets: [suitedOnly, setNamed(DISCOVERY_SET_ID)] })
    expect(html).toContain('<optgroup label="Suits this company"><option value="qs-full-discovery" selected="">Full discovery</option></optgroup>')
    expect(html).toContain('<optgroup label="Other sets"><option value="qs-teardown">Teardown</option></optgroup>')
    expect(html).toContain('Sets that apply to this company are listed first.')
  })

  it('takes the time it was held and ticks the attendees from the contacts', () => {
    const html = renderPanel({ questionSetId: DISCOVERY_SET_ID, heldAt: '2026-09-18T09:05', attendees: ['Marta Ivanova'] }, { contacts: ['Marta Ivanova', 'Ivo Petrov'] })
    expect(tagFor(html, 'heldAt')).toContain('type="datetime-local"')
    expect(tagFor(html, 'heldAt')).toContain('value="2026-09-18T09:05"')
    expect(html).toContain('<input type="checkbox" checked=""/>Marta Ivanova')
    expect(html).toContain('<input type="checkbox"/>Ivo Petrov')
    expect(renderPanel({ questionSetId: '', heldAt: '', attendees: [] }, { contacts: [] })).toContain('This engagement has no contacts yet.')
  })

  it('refuses to start without a set to run', () => {
    expect(renderPanel({ questionSetId: '', heldAt: '', attendees: [] }, { issue: 'Choose a question set to run' })).toContain('<li>Choose a question set to run</li>')
  })
})
