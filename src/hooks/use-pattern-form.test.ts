import { describe, expect, it } from 'vitest'
import type { Pattern } from '../schema/library'
import { NOT_A_NUMBER, VALUE_REQUIRED } from './use-traced-draft'
import {
  addToList,
  canSave,
  discardPatternEdits,
  formIssues,
  hasChanges,
  initialPatternForm,
  locatedPaths,
  numberText,
  otherProblems,
  patternFormView,
  receivePattern,
  removeFromList,
  setChoice,
  setNumberText,
  setText,
  type PatternFormState,
} from './use-pattern-form'

function p(extra: Partial<Pattern> = {}): Pattern {
  return {
    id: 'pat-x',
    name: 'A pattern',
    category: 'ops',
    problem: '',
    solution: '',
    architecture: '',
    requiredIntegrations: [],
    complexity: 'low',
    baseHours: 5,
    risks: [],
    clientExplanation: '',
    blueprintSkeleton: null,
    codeNotes: '',
    usedInEngagements: [],
    ...extra,
  }
}

function paths(state: PatternFormState): string[] {
  return formIssues(state).map((issue) => issue.path)
}

describe('starting and receiving', () => {
  it('starts with nothing to save, and a valid pattern has no issues', () => {
    const state = initialPatternForm(p())
    expect(formIssues(state)).toEqual([])
    expect(hasChanges(state)).toBe(false)
    expect(canSave(state)).toBe(false)
  })

  it('keeps an edit through a reload that brings the same pattern, and starts again when it changed', () => {
    const edited = setText(initialPatternForm(p()), 'name', 'Renamed')
    expect(receivePattern(edited, p()).draft.name).toBe('Renamed')
    const saved = { ...p(), name: 'Renamed' }
    expect(receivePattern(edited, saved)).toEqual(initialPatternForm(saved, edited.generation + 1))
  })

  it('discards every edit with a new generation', () => {
    const edited = setNumberText(setText(initialPatternForm(p()), 'name', 'X'), 'baseHours', 'twelve')
    expect(discardPatternEdits(edited)).toEqual(initialPatternForm(p(), edited.generation + 1))
  })
})

describe('fields', () => {
  it('edits every text field, and refuses a blank name at its path', () => {
    let state = setText(initialPatternForm(p()), 'name', ' ')
    state = setText(state, 'category', 'finance')
    state = setText(state, 'problem', 'Invoices are typed by hand.')
    state = setText(state, 'solution', 'They are extracted automatically.')
    state = setText(state, 'architecture', 'OCR then post to accounting.')
    state = setText(state, 'clientExplanation', 'It reads the invoice for you.')
    state = setText(state, 'codeNotes', 'Keep the matching tolerance configurable.')
    expect(state.draft).toMatchObject({
      category: 'finance',
      problem: 'Invoices are typed by hand.',
      solution: 'They are extracted automatically.',
      architecture: 'OCR then post to accounting.',
      clientExplanation: 'It reads the invoice for you.',
      codeNotes: 'Keep the matching tolerance configurable.',
    })
    expect(paths(state)).toEqual(['name'])
    expect(canSave(state)).toBe(false)
  })

  it('edits complexity by choice', () => {
    const state = setChoice(initialPatternForm(p()), 'complexity', 'high')
    expect(state.draft.complexity).toBe('high')
  })
})

describe('base hours', () => {
  it('reads it as typed, and keeps unparseable text out of the draft', () => {
    const initial = initialPatternForm(p())
    const typed = setNumberText(initial, 'baseHours', '12')
    expect(typed.draft.baseHours).toBe(12)
    const invalid = setNumberText(typed, 'baseHours', 'twelve')
    expect(invalid.draft.baseHours).toBe(12)
    expect(formIssues(invalid)).toEqual([{ path: 'baseHours', message: NOT_A_NUMBER }])
    expect(numberText(invalid, 'baseHours')).toBe('twelve')
  })

  it('requires it, since it is never optional: clearing it leaves the draft as it was and blocks saving', () => {
    const cleared = setNumberText(initialPatternForm(p()), 'baseHours', '')
    expect(cleared.draft.baseHours).toBe(5)
    expect(formIssues(cleared)).toEqual([{ path: 'baseHours', message: VALUE_REQUIRED }])
    expect(canSave(cleared)).toBe(false)
  })

  it('refuses zero and a negative value at the schema, since a zero-hour pattern would make its build free', () => {
    const zero = setNumberText(initialPatternForm(p()), 'baseHours', '0')
    expect(paths(zero)).toEqual(['baseHours'])
    const negative = setNumberText(initialPatternForm(p()), 'baseHours', '-3')
    expect(paths(negative)).toEqual(['baseHours'])
  })
})

describe('lists', () => {
  it('adds a blank entry to requiredIntegrations and risks, and refuses a blank one at its index', () => {
    let state = addToList(initialPatternForm(p()), 'requiredIntegrations')
    expect(state.draft.requiredIntegrations).toEqual([''])
    state = addToList(state, 'risks')
    expect(state.draft.risks).toEqual([''])
  })

  it('removes an entry by index, leaving the rest', () => {
    const withTwo = { ...initialPatternForm(p()), draft: { ...p(), requiredIntegrations: ['Gmail', 'HubSpot'] } }
    expect(removeFromList(withTwo, 'requiredIntegrations', 0).draft.requiredIntegrations).toEqual(['HubSpot'])
  })

  it('edits a list item by its path', () => {
    const withOne = addToList(initialPatternForm(p()), 'risks')
    const edited = setText(withOne, 'risks.0', 'A supplier format the extraction has not seen')
    expect(edited.draft.risks).toEqual(['A supplier format the extraction has not seen'])
  })
})

describe('issues and saving', () => {
  it('locates every field the pattern has, including list items once they exist', () => {
    const withItems = addToList(addToList(initialPatternForm(p()), 'requiredIntegrations'), 'risks')
    const located = locatedPaths(withItems.draft)
    for (const path of [
      'name',
      'category',
      'problem',
      'solution',
      'architecture',
      'complexity',
      'baseHours',
      'clientExplanation',
      'codeNotes',
      'requiredIntegrations',
      'requiredIntegrations.0',
      'risks',
      'risks.0',
    ]) {
      expect(located.has(path), path).toBe(true)
    }
  })

  it('lists an issue at a path with no field as another problem', () => {
    const state = initialPatternForm(p())
    const issues = [{ path: 'id', message: 'x' }, { path: 'name', message: 'y' }]
    expect(otherProblems(state.draft, issues)).toEqual([issues[0]])
  })

  it('can save only once something changed and nothing is wrong', () => {
    const state = initialPatternForm(p())
    expect(canSave(state)).toBe(false)
    const edited = setText(state, 'category', 'finance')
    expect(canSave(edited)).toBe(true)
    const broken = setText(edited, 'name', '')
    expect(canSave(broken)).toBe(false)
  })
})

describe('patternFormView', () => {
  it('exposes issues, text and choice reading, and a working discard', () => {
    const state = setText(initialPatternForm(p()), 'name', '')
    const view = patternFormView(state, () => undefined)
    expect(view.issuesAt('name')).toEqual(['A pattern needs a name'])
    expect(view.textAt('category')).toBe('ops')
    expect(view.canSave).toBe(false)
    expect(view.changed).toBe(true)
  })
})
