import { describe, expect, it } from 'vitest'
import { engagement, newEngagement, scoringResult } from '../schema/__fixtures__/records'
import { EngagementSchema, type Engagement } from '../schema/engagement'
import { DISCOVERY_SET_ID, seedQuestionSets } from '../schema/seed-question-sets'
import type { TracedValue } from '../schema/traced'
import { completeness, newSession, questionStates } from './discovery-rules'
import { leafPaths } from './form-paths'
import {
  addContact,
  addIntegration,
  addOpportunity,
  addSession,
  addStep,
  addToList,
  canSave,
  clearAnswer,
  discardEngagementEdits,
  editsOf,
  engagementFormView,
  formIssues,
  hasChanges,
  hasUnsavedEdits,
  initialEngagementForm,
  locatedPaths,
  locatesIssue,
  mergedEngagement,
  moveStep,
  NOT_EDITED,
  numberText,
  otherProblems,
  receiveEngagement,
  removeFromList,
  removeIntegration,
  removeOpportunity,
  removeProcess,
  removeSession,
  removeStep,
  setAnswerTraced,
  setAnswerValue,
  setAttendees,
  setChoice,
  setFlag,
  setNumberText,
  setPending,
  setText,
  setTraced,
  tabOf,
  toggleAnswerFlag,
  togglePatternLink,
  toggleProcessLink,
  type EngagementFormState,
} from './use-engagement-form'
import { NOT_A_NUMBER } from './use-traced-draft'

const COST: TracedValue = { value: 18, unit: 'EUR/hour', currency: 'EUR', source: 'client-stated' }

function paths(state: EngagementFormState): string[] {
  return formIssues(state).map((issue) => issue.path)
}

describe('starting and receiving', () => {
  it('starts with the draft as loaded, nothing typed or pending, and nothing to save', () => {
    const state = initialEngagementForm(engagement())
    expect(state.draft).toEqual(editsOf(engagement()))
    expect(state.base).toEqual(state.draft)
    expect(formIssues(state)).toEqual([])
    expect(hasChanges(state)).toBe(false)
    expect(canSave(state)).toBe(false)
  })

  it('keeps an edit when a reload brings the same slices, such as a recompute of cached results', () => {
    const edited = setText(initialEngagementForm(engagement()), 'company.name', 'Rila Freight')
    const recomputed: Engagement = { ...engagement(), opportunities: engagement().opportunities.map((item) => ({ ...item, scoring: { ...scoringResult(), computedAt: '2026-09-17T10:00:00.000Z' } })) }
    const received = receiveEngagement(edited, recomputed)
    expect(received.draft.company.name).toBe('Rila Freight')
    expect(received.saved).toBe(recomputed)
    expect(received.generation).toBe(edited.generation)
    expect(mergedEngagement(received).opportunities).toEqual(recomputed.opportunities)
  })

  it('starts again, with a new generation, when the stored slices change, such as after its own save', () => {
    const edited = setText(initialEngagementForm(engagement()), 'company.name', 'Rila Freight')
    const saved = { ...mergedEngagement(edited), updatedAt: '2026-09-17T10:00:00.000Z' }
    const received = receiveEngagement(edited, saved)
    expect(received).toEqual(initialEngagementForm(saved, edited.generation + 1))
    expect(hasChanges(received)).toBe(false)
  })

  it('returns the very same state when given the engagement it already holds', () => {
    const state = initialEngagementForm(engagement())
    expect(receiveEngagement(state, state.saved)).toBe(state)
  })

  it('discards every edit, typed text and pending field, with a new generation to remount the controls', () => {
    let state = setText(initialEngagementForm(engagement()), 'company.name', 'X')
    state = setNumberText(state, 'company.employeeCount', 'forty')
    state = setPending(state, 'company.blendedHourlyCost', true)
    expect(discardEngagementEdits(state)).toEqual(initialEngagementForm(engagement(), state.generation + 1))
  })
})

describe('fields', () => {
  it('sets required and optional text, removing an optional key when cleared', () => {
    let state = setText(initialEngagementForm(engagement()), 'company.sourceOfTruth', '')
    expect('sourceOfTruth' in state.draft.company).toBe(false)
    state = setText(state, 'contacts.0.email', 'marta@rila.bg')
    expect(state.draft.contacts[0]?.email).toBe('marta@rila.bg')
    state = setText(state, 'company.constraints.securityNotes', 'VPN only')
    expect(state.draft.company.constraints.securityNotes).toBe('VPN only')
    expect(() => setText(state, 'company.employeeCount', '4')).toThrow('There is no text field')
  })

  it('sets choices, and clears the optional delivery model with an empty choice', () => {
    let state = setChoice(initialEngagementForm(engagement()), 'source', 'referral')
    state = setChoice(state, 'company.currency', 'GBP')
    state = setChoice(state, 'company.preferredDeliveryModel', '')
    expect(state.draft.source).toBe('referral')
    expect(state.draft.company.currency).toBe('GBP')
    expect('preferredDeliveryModel' in state.draft.company).toBe(false)
  })

  it('reads the employee count as typed, removes it when cleared, and never lets unparseable text reach the draft', () => {
    const initial = initialEngagementForm(engagement())
    expect(numberText(initial, 'company.employeeCount')).toBe('40')
    const typed = setNumberText(initial, 'company.employeeCount', '45')
    expect(typed.draft.company.employeeCount).toBe(45)
    const cleared = setNumberText(initial, 'company.employeeCount', '')
    expect('employeeCount' in cleared.draft.company).toBe(false)
    expect(formIssues(cleared)).toEqual([])
    const invalid = setNumberText(initial, 'company.employeeCount', 'forty')
    expect(invalid.draft.company.employeeCount).toBe(40)
    expect(formIssues(invalid)).toEqual([{ path: 'company.employeeCount', message: NOT_A_NUMBER }])
    expect(hasUnsavedEdits(invalid)).toBe(true)
    expect(canSave(invalid)).toBe(false)
    expect(paths(setNumberText(initial, 'company.employeeCount', '2.5'))).toEqual(['company.employeeCount'])
  })

  it('sets a flag and the traced cost', () => {
    let state = setFlag(initialEngagementForm(engagement()), 'contacts.0.isDecisionMaker', false)
    state = setTraced(state, 'company.blendedHourlyCost', COST)
    expect(state.draft.contacts[0]?.isDecisionMaker).toBe(false)
    expect(state.draft.company.blendedHourlyCost).toEqual(COST)
    expect(setTraced(state, 'company.blendedHourlyCost', null).draft.company.blendedHourlyCost).toBeNull()
    expect(() => setTraced(state, 'company.name', COST)).toThrow('There is no traced field')
  })

  it('blocks saving while a traced field holds text that has not reached the draft', () => {
    const changed = setTraced(initialEngagementForm(engagement()), 'company.blendedHourlyCost', COST)
    expect(canSave(changed)).toBe(true)
    const pending = setPending(changed, 'company.blendedHourlyCost', true)
    expect(canSave(pending)).toBe(false)
    expect(hasUnsavedEdits(setPending(initialEngagementForm(engagement()), 'company.blendedHourlyCost', true))).toBe(true)
    expect(engagementFormView(pending, () => undefined).problems).toBe(1)
    const resolved = setPending(pending, 'company.blendedHourlyCost', false)
    expect(canSave(resolved)).toBe(true)
    expect(setPending(resolved, 'company.blendedHourlyCost', false)).toBe(resolved)
  })
})

describe('next action', () => {
  it('creates one from text, keeps a due date only when set, and removes it when both are cleared', () => {
    let state = setText(initialEngagementForm(newEngagement()), 'nextAction.text', 'Call Marta')
    expect(state.draft.nextAction).toEqual({ text: 'Call Marta' })
    state = setText(state, 'nextAction.due', '2026-09-20')
    expect(state.draft.nextAction).toEqual({ text: 'Call Marta', due: '2026-09-20' })
    state = setText(state, 'nextAction.due', '')
    expect(state.draft.nextAction).toEqual({ text: 'Call Marta' })
    state = setText(state, 'nextAction.text', '')
    expect(state.draft.nextAction).toBeNull()
  })

  it('refuses a due date without text, at the text', () => {
    const state = setText(initialEngagementForm(newEngagement()), 'nextAction.due', '2026-09-20')
    expect(state.draft.nextAction).toEqual({ text: '', due: '2026-09-20' })
    expect(paths(state)).toEqual(['nextAction.text'])
  })
})

describe('lists', () => {
  it('adds a blank tag, stated tool or compliance entry, which the schema refuses until filled in', () => {
    let state = addToList(initialEngagementForm(newEngagement()), 'tags')
    expect(paths(state)).toEqual(['tags.0'])
    state = setText(state, 'tags.0', 'bakery')
    state = addToList(state, 'company.statedTools')
    state = setText(state, 'company.statedTools.0', 'Shopify')
    state = addToList(state, 'company.constraints.compliance')
    state = setText(state, 'company.constraints.compliance.0', 'GDPR')
    expect(state.draft.tags).toEqual(['bakery'])
    expect(state.draft.company.statedTools).toEqual(['Shopify'])
    expect(state.draft.company.constraints.compliance).toEqual(['GDPR'])
    expect(formIssues(state)).toEqual([])
    expect(removeFromList(state, 'tags', 0).draft.tags).toEqual([])
  })

  it('adds a contact with the given id and no name, which the schema refuses, and removes contacts', () => {
    const state = addContact(initialEngagementForm(engagement()), 'ct-new')
    expect(state.draft.contacts[1]).toEqual({ id: 'ct-new', name: '', isDecisionMaker: false })
    expect(formIssues(state)).toEqual([{ path: 'contacts.1.name', message: 'A contact needs a name' }])
    const removed = removeFromList(state, 'contacts', 0)
    expect(removed.draft.contacts.map((contact) => contact.id)).toEqual(['ct-new'])
    expect(canSave(removeFromList(removed, 'contacts', 0))).toBe(true)
  })
})

describe('issues and saving', () => {
  it('saves the draft on top of the latest loaded engagement, never a stale copy of the rest', () => {
    const state = setText(initialEngagementForm(engagement()), 'company.name', 'Rila Freight')
    const merged = mergedEngagement(state)
    expect(merged.company.name).toBe('Rila Freight')
    expect({ ...merged, company: engagement().company }).toEqual(engagement())
  })

  it('reports each capture rule at its path, and every such path is located', () => {
    let state = setText(initialEngagementForm(engagement()), 'company.name', ' ')
    state = setText(state, 'company.website', 'rila.bg')
    state = setNumberText(state, 'company.employeeCount', '-3')
    state = setText(state, 'contacts.0.name', '')
    state = setText(state, 'contacts.0.email', 'marta@')
    state = addToList(state, 'tags')
    state = setText(state, 'nextAction.text', '')
    state = setText(state, 'nextAction.due', '2026-02-30')
    const issues = formIssues(state)
    expect(issues.map((issue) => issue.path).sort()).toEqual(
      ['company.name', 'company.website', 'company.employeeCount', 'contacts.0.name', 'contacts.0.email', 'tags.1', 'nextAction.text', 'nextAction.due'].sort(),
    )
    expect(otherProblems(state.draft, issues)).toEqual([])
    expect(canSave(state)).toBe(false)
  })

  it('lists an issue at a path with no field as another problem', () => {
    const state = initialEngagementForm(engagement())
    const issues = [
      { path: 'company.blendedHourlyCost.currency', message: 'x' },
      { path: 'company.name', message: 'y' },
    ]
    expect(otherProblems(state.draft, issues)).toEqual([issues[0]])
  })

  it('locates every leaf of the edited slices, except the ones the screen shows but does not edit', () => {
    const draft = editsOf(engagement())
    const located = locatedPaths(draft)
    // Leaves covered by one control rather than a field each: a traced figure holds its value, unit,
    // source and note, and a linked process or pattern is ticked in a group that carries the list path.
    // Their issues show at that control, or under Other problems where it shows none.
    const insideOneControl = (path: string) =>
      (/\.(value|unit|currency|source|note|capturedAt|answerId)$/.test(path) || /\.(processIds|patternIds)\.\d+$/.test(path)) &&
      located.has(path.replace(/\.[^.]+$/, ''))
    // replaceAll, not replace: a prefix with two wildcards ('processes.*.steps.*.id') would otherwise
    // keep the second star, which reads as a quantifier and matches nothing.
    const notEdited = (path: string) =>
      insideOneControl(path) || NOT_EDITED.some(({ prefix }) => new RegExp(`^${prefix.replace(/\./g, '\\.').replaceAll('*', '\\d+')}(\\.|$)`).test(path))
    for (const path of leafPaths(draft)) {
      if (!notEdited(path)) expect(locatesIssue(draft, path), path).toBe(true)
    }
    expect(located.has('company.blendedHourlyCost')).toBe(true)
    expect(located.has('contacts.0.id')).toBe(false)
  })

  it('names the tab each path is edited on', () => {
    expect(tabOf('source')).toBe('overview')
    expect(tabOf('tags.2')).toBe('overview')
    expect(tabOf('nextAction.due')).toBe('overview')
    expect(tabOf('company.constraints.compliance.0')).toBe('company')
    expect(tabOf('contacts.1.email')).toBe('contacts')
    expect(tabOf('stageHistory.0.at')).toBeNull()
  })

  it('counts issues by tab in the view', () => {
    let state = setText(initialEngagementForm(engagement()), 'company.name', '')
    state = setText(state, 'contacts.0.name', '')
    state = setText(state, 'contacts.0.email', 'x')
    expect(engagementFormView(state, () => undefined).tabIssues).toEqual({ overview: 0, company: 1, contacts: 2, discovery: 0, processes: 0, opportunities: 0 })
  })
})

describe('processes and opportunities', () => {
  const scored = (): Engagement => {
    const record = engagement()
    return { ...record, opportunities: record.opportunities.map((opportunity) => ({ ...opportunity, scoring: scoringResult() })) }
  }

  it('keeps the cached score out of the draft, so a recompute is never an edit', () => {
    const edits = editsOf(scored())
    expect(edits.opportunities[0] && 'scoring' in edits.opportunities[0]).toBe(false)
    // The very case this exists for: a reload that only replaced a cached score leaves an edit alone.
    const state = setText(initialEngagementForm(scored()), 'company.name', 'Rila Freight')
    const recomputed = { ...scored(), opportunities: scored().opportunities.map((o) => ({ ...o, scoring: { ...scoringResult(), confidence: 40 } })) }
    const received = receiveEngagement(state, recomputed)
    expect(received.draft.company.name).toBe('Rila Freight')
    expect(received.generation).toBe(state.generation)
  })

  it('puts each cached score back by id when saving, and gives a new opportunity a null one', () => {
    const state = initialEngagementForm(scored())
    const held = state.draft.opportunities[0]
    if (held === undefined) throw new Error('the fixture has no opportunity')
    const merged = mergedEngagement(addOpportunity(state, { ...held, id: 'opp-new', title: 'A second idea' }))
    expect(merged.opportunities[0]?.scoring).toEqual(scoringResult())
    expect(merged.opportunities[1]?.scoring).toBeNull()
    expect(EngagementSchema.safeParse(merged).success).toBe(true)
  })

  it('counts a process and an opportunity problem on its own tab', () => {
    let state = setText(initialEngagementForm(engagement()), 'processes.0.name', ' ')
    state = setText(state, 'opportunities.0.title', '')
    const view = engagementFormView(state, () => undefined)
    expect(view.tabIssues).toMatchObject({ processes: 1, opportunities: 1 })
    expect(tabOf('processes.0.steps.0.action')).toBe('processes')
    expect(tabOf('opportunities.0.effortInputs.novelty')).toBe('opportunities')
  })

  it('refuses to clear a figure the schema requires, which no control offers to clear', () => {
    const state = initialEngagementForm(engagement())
    expect(() => setTraced(state, 'processes.0.frequency.peopleInvolved', null)).toThrow(/required/)
    expect(setTraced(state, 'processes.0.roleHourlyCost', null).draft.processes[0]?.roleHourlyCost).toBeNull()
  })

  it('adds and removes a step, dropping typed text under the list whose rows have shifted', () => {
    let state = addStep(initialEngagementForm(engagement()), 0, 'step-9')
    expect(state.draft.processes[0]?.steps).toHaveLength(2)
    state = setNumberText(state, 'processes.0.steps.1.waitTimeMinutes', '15')
    expect(state.draft.processes[0]?.steps[1]?.waitTimeMinutes).toBe(15)
    expect(removeStep(state, 0, 0).texts['processes.0.steps.1.waitTimeMinutes']).toBeUndefined()
    expect(moveStep(state, 0, 1, -1).draft.processes[0]?.steps[0]?.id).toBe('step-9')
  })

  it('clears the primary pattern when the pattern it names is unlinked, which the schema would refuse', () => {
    const state = initialEngagementForm(engagement())
    expect(state.draft.opportunities[0]?.primaryPatternId).toBe('pat-email-triage')
    const unlinked = togglePatternLink(state, 0, 'pat-email-triage', false)
    expect(unlinked.draft.opportunities[0]?.patternIds).toEqual(['pat-crm-sync'])
    expect(unlinked.draft.opportunities[0]?.primaryPatternId).toBeNull()
    expect(formIssues(unlinked)).toEqual([])
  })

  it('refuses an opportunity that names no process, where the picker shows it', () => {
    const state = toggleProcessLink(initialEngagementForm(engagement()), 0, 'proc-1', false)
    expect(formIssues(state)).toEqual([{ path: 'opportunities.0.processIds', message: 'An opportunity is about at least one process' }])
    expect(otherProblems(state.draft, formIssues(state))).toEqual([])
  })

  it('adds an integration blank, so the schema refuses it until it is named or removed', () => {
    const state = addIntegration(initialEngagementForm(engagement()), 0)
    expect(state.draft.opportunities[0]?.effortInputs.integrations).toHaveLength(2)
    expect(paths(state)).toEqual(['opportunities.0.effortInputs.integrations.1.name'])
    expect(formIssues(removeIntegration(state, 0, 1))).toEqual([])
  })

  it('removes a process and an opportunity, dropping the text under each', () => {
    let state = setText(initialEngagementForm(engagement()), 'processes.0.name', 'Renamed')
    state = removeProcess(state, 0)
    expect(state.draft.processes).toEqual([])
    expect(removeOpportunity(initialEngagementForm(engagement()), 0).draft.opportunities).toEqual([])
  })
})

describe('discovery sessions', () => {
  const sets = seedQuestionSets()
  const discoverySet = () => {
    const found = sets.find((candidate) => candidate.id === DISCOVERY_SET_ID)
    if (found === undefined) throw new Error('no seeded discovery set')
    return found
  }
  const question = (id: string) => {
    const found = discoverySet().questions.find((candidate) => candidate.id === id)
    if (found === undefined) throw new Error(`no question ${id}`)
    return found
  }
  const HELD_AT = '2026-09-18T09:00:00.000Z'
  const started = () => addSession(initialEngagementForm(newEngagement()), newSession('ds-1', discoverySet(), HELD_AT, ['Marta Ivanova']))

  it('starts a session from a set, and removes one', () => {
    const state = started()
    expect(state.draft.discovery[0]).toMatchObject({
      id: 'ds-1',
      kind: 'discovery',
      questionSetId: DISCOVERY_SET_ID,
      heldAt: HELD_AT,
      attendees: ['Marta Ivanova'],
      answers: [],
      rawNotes: '',
    })
    expect(formIssues(state)).toEqual([])
    expect(canSave(state)).toBe(true)
    expect(removeSession(state, 0).draft.discovery).toEqual([])
  })

  it('edits the notes, the time it was held and who attended', () => {
    let state = setText(started(), 'discovery.0.rawNotes', 'Keen to start before peak season.')
    state = setText(state, 'discovery.0.heldAt', '2026-09-19T10:00:00.000Z')
    state = setAttendees(state, 0, ['Marta Ivanova', 'Ivo Petrov'])
    expect(state.draft.discovery[0]).toMatchObject({
      rawNotes: 'Keen to start before peak season.',
      heldAt: '2026-09-19T10:00:00.000Z',
      attendees: ['Marta Ivanova', 'Ivo Petrov'],
    })
  })

  it('stores an answer, and recomputes completeness and follow-ups as the branch opens and closes', () => {
    let state = setAnswerValue(started(), sets, 0, question('fd-business'), 'Freight forwarding for retailers', 'ans-1')
    expect(state.draft.discovery[0]?.answers[0]).toMatchObject({ id: 'ans-1', questionId: 'fd-business', kind: 'text', value: 'Freight forwarding for retailers', flags: [] })

    const basis = (at: EngagementFormState) => completeness(questionStates(discoverySet(), at.draft.discovery[0]?.answers ?? []))

    state = setAnswerValue(state, sets, 0, question('fd-errors'), true, 'ans-2')
    expect(state.draft.discovery[0]?.answers[1]?.followUpTriggered).toEqual(['fd-error-rate', 'fd-error-cost', 'fd-error-example'])
    const opened = basis(state)
    expect(state.draft.discovery[0]?.completeness).toBe(opened.percent)

    state = setAnswerValue(state, sets, 0, question('fd-errors'), false, 'ans-3')
    expect(state.draft.discovery[0]?.answers[1]).toMatchObject({ id: 'ans-2', value: false, followUpTriggered: [] })
    // The two required questions behind the branch stop counting the moment it closes.
    const closed = basis(state)
    expect(closed.required).toBe(opened.required - 2)
    expect(state.draft.discovery[0]?.completeness).toBe(closed.percent)
  })

  it('lands a figure on the company at once, with its source and note, linked to the answer', () => {
    const traced: TracedValue = { value: 21.5, unit: 'EUR/hour', currency: 'EUR', source: 'client-stated', note: 'Marta: about 21.50 all in' }
    const state = setAnswerTraced(started(), sets, 0, question('fd-hourly-cost'), traced, 'ans-cost')
    expect(state.draft.discovery[0]?.answers[0]).toMatchObject({ id: 'ans-cost', kind: 'number', value: 21.5 })
    expect(state.draft.company.blendedHourlyCost).toEqual({ ...traced, answerId: 'ans-cost', capturedAt: HELD_AT })
    expect(formIssues(state)).toEqual([])
  })

  it('lands a list answer by adding what is missing, and leaves the path alone when the answer is cleared', () => {
    let state = setAnswerValue(started(), sets, 0, question('fd-tools'), ['HubSpot', 'Xero'], 'ans-tools')
    expect(state.draft.company.statedTools).toEqual(['HubSpot', 'Xero'])
    state = clearAnswer(state, sets, 0, question('fd-tools'))
    expect(state.draft.discovery[0]?.answers).toEqual([])
    expect(state.draft.company.statedTools).toEqual(['HubSpot', 'Xero'])
  })

  it('stores a process answer without landing it anywhere yet', () => {
    const traced: TracedValue = { value: 120, unit: 'count/month', source: 'client-stated' }
    const state = setAnswerTraced(started(), sets, 0, question('fd-occurrences'), traced, 'ans-occ')
    expect(state.draft.discovery[0]?.answers[0]?.traced).toMatchObject({ value: 120, answerId: 'ans-occ', capturedAt: HELD_AT })
    expect(state.draft.company).toEqual(newEngagement().company)
  })

  it('flags an answer, starting an empty one when the question has not been answered yet', () => {
    let state = toggleAnswerFlag(started(), sets, 0, question('fd-business'), 'pain', true, 'ans-flag')
    expect(state.draft.discovery[0]?.answers[0]).toMatchObject({ id: 'ans-flag', value: '', flags: ['pain'] })
    state = toggleAnswerFlag(state, sets, 0, question('fd-business'), 'blocker', true, 'ans-ignored')
    expect(state.draft.discovery[0]?.answers[0]?.flags).toEqual(['pain', 'blocker'])
    state = toggleAnswerFlag(state, sets, 0, question('fd-business'), 'pain', false, 'ans-ignored')
    expect(state.draft.discovery[0]?.answers[0]?.flags).toEqual(['blocker'])
  })

  it('shows an answer’s issue on its own row, and counts it on the discovery tab', () => {
    const state = setAnswerValue(started(), sets, 0, question('fd-tools'), ['HubSpot', 'HubSpot'], 'ans-dupe')
    expect(formIssues(state)).toEqual([{ path: 'discovery.0.answers.0.value.1', message: "'HubSpot' is already chosen" }])
    expect(otherProblems(state.draft, formIssues(state))).toEqual([])
    expect(locatesIssue(state.draft, 'discovery.0.answers.0.value.1')).toBe(true)
    expect(engagementFormView(state, () => undefined).tabIssues.discovery).toBe(1)
    expect(canSave(state)).toBe(false)
  })

  it('keeps editing a session whose question set has gone, recomputing nothing', () => {
    const state = setAnswerValue(started(), sets, 0, question('fd-business'), 'Freight', 'ans-1')
    const orphaned = setAnswerValue(state, [], 0, question('fd-business'), 'Freight forwarding', 'ans-1')
    expect(orphaned.draft.discovery[0]?.answers[0]?.value).toBe('Freight forwarding')
    expect(orphaned.draft.discovery[0]?.completeness).toBe(state.draft.discovery[0]?.completeness)
  })
})
