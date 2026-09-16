import { describe, expect, it } from 'vitest'
import { engagement, newEngagement, scoringResult } from '../schema/__fixtures__/records'
import type { Engagement } from '../schema/engagement'
import type { TracedValue } from '../schema/traced'
import { leafPaths } from './form-paths'
import {
  addContact,
  addToList,
  canSave,
  discardEngagementEdits,
  editsOf,
  engagementFormView,
  formIssues,
  hasChanges,
  hasUnsavedEdits,
  initialEngagementForm,
  locatedPaths,
  mergedEngagement,
  NOT_EDITED,
  numberText,
  otherProblems,
  receiveEngagement,
  removeFromList,
  setChoice,
  setFlag,
  setNumberText,
  setPending,
  setText,
  setTraced,
  tabOf,
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
    const notEdited = (path: string) =>
      path.startsWith('company.blendedHourlyCost.') || NOT_EDITED.some(({ prefix }) => new RegExp(`^${prefix.replace(/\./g, '\\.').replace('*', '\\d+')}(\\.|$)`).test(path))
    for (const path of leafPaths(draft)) {
      if (!notEdited(path)) expect(located.has(path), path).toBe(true)
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
    expect(engagementFormView(state, () => undefined).tabIssues).toEqual({ overview: 0, company: 1, contacts: 2 })
  })
})
