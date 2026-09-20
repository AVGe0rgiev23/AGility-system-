import { describe, expect, it } from 'vitest'
import type { Question, QuestionSet } from '../schema/discovery'
import { DISCOVERY_SET_ID, seedQuestionSets } from '../schema/seed-question-sets'
import { NOT_A_NUMBER, VALUE_REQUIRED } from './use-traced-draft'
import {
  addChoice,
  addQuestion,
  canSave,
  defaultLeaf,
  discardQuestionSetEdits,
  formIssues,
  hasChanges,
  initialQuestionSetForm,
  locatedPaths,
  moveQuestion,
  numberText,
  otherProblems,
  questionSetFormView,
  receiveQuestionSet,
  removeChoice,
  removeQuestion,
  setChoice,
  setConditionAt,
  setFlag,
  setNumberText,
  setQuestionKind,
  setText,
  toggleIndustry,
  togglePattern,
  type QuestionSetFormState,
} from './use-question-set-form'

function q(id: string, extra: Partial<Question> = {}): Question {
  return { id, text: `Question ${id}`, kind: 'text', required: false, ...extra }
}

function set(...questions: Question[]): QuestionSet {
  return { id: 'qs', name: 'Set', kind: 'teardown', appliesTo: {}, questions }
}

function discovery(): QuestionSet {
  const found = seedQuestionSets().find((candidate) => candidate.id === DISCOVERY_SET_ID)
  if (found === undefined) throw new Error('no seed')
  return found
}

function paths(state: QuestionSetFormState): string[] {
  return formIssues(state).map((issue) => issue.path)
}

describe('starting and receiving', () => {
  it('starts with nothing to save, and a valid seed set has no issues', () => {
    const state = initialQuestionSetForm(discovery())
    expect(formIssues(state)).toEqual([])
    expect(hasChanges(state)).toBe(false)
    expect(canSave(state)).toBe(false)
  })

  it('keeps an edit through a reload that brings the same set, and starts again when the set changed', () => {
    const edited = setText(initialQuestionSetForm(set(q('a'))), 'name', 'Renamed')
    expect(receiveQuestionSet(edited, set(q('a'))).draft.name).toBe('Renamed')
    const saved = { ...set(q('a')), name: 'Renamed' }
    expect(receiveQuestionSet(edited, saved)).toEqual(initialQuestionSetForm(saved, edited.generation + 1))
  })

  it('discards every edit with a new generation', () => {
    const edited = setNumberText(setText(initialQuestionSetForm(set(q('a'))), 'name', 'X'), 'appliesTo.minEmployees', 'ten')
    expect(discardQuestionSetEdits(edited)).toEqual(initialQuestionSetForm(set(q('a')), edited.generation + 1))
  })
})

describe('set fields', () => {
  it('edits the name and kind, and refuses a blank name at its path', () => {
    let state = setText(initialQuestionSetForm(set(q('a'))), 'name', ' ')
    state = setChoice(state, 'kind', 'follow-up')
    expect(state.draft.kind).toBe('follow-up')
    expect(paths(state)).toEqual(['name'])
    expect(canSave(state)).toBe(false)
  })

  it('reads the minimum employee count as typed, removes it when cleared, and keeps unparseable text out of the draft', () => {
    const initial = initialQuestionSetForm(set(q('a')))
    const typed = setNumberText(initial, 'appliesTo.minEmployees', '5')
    expect(typed.draft.appliesTo).toEqual({ minEmployees: 5 })
    expect(setNumberText(typed, 'appliesTo.minEmployees', '').draft.appliesTo).toEqual({})
    const invalid = setNumberText(typed, 'appliesTo.minEmployees', 'five')
    expect(invalid.draft.appliesTo).toEqual({ minEmployees: 5 })
    expect(formIssues(invalid)).toEqual([{ path: 'appliesTo.minEmployees', message: NOT_A_NUMBER }])
    expect(numberText(invalid, 'appliesTo.minEmployees')).toBe('five')
  })

  it('picks industries by toggling, and drops the list when none is picked', () => {
    let state = toggleIndustry(initialQuestionSetForm(set(q('a'))), 'E-commerce', true)
    state = toggleIndustry(state, 'Software / Tech', true)
    state = toggleIndustry(state, 'E-commerce', true)
    expect(state.draft.appliesTo.industries).toEqual(['E-commerce', 'Software / Tech'])
    state = toggleIndustry(toggleIndustry(state, 'E-commerce', false), 'Software / Tech', false)
    expect(state.draft.appliesTo).toEqual({})
  })
})

describe('questions', () => {
  it('adds a question with the given id and no text, which is refused until it has some', () => {
    const state = addQuestion(initialQuestionSetForm(set(q('a'))), 'q-new')
    expect(state.draft.questions[1]).toEqual({ id: 'q-new', text: '', kind: 'text', required: false })
    expect(paths(state)).toEqual(['questions.1.text'])
  })

  it('edits text, help text, the required flag, and clears an optional mapping', () => {
    let state = setText(initialQuestionSetForm(set(q('a', { kind: 'multi', choices: ['x'], mapsTo: 'company.statedTools' }))), 'questions.0.helpText', 'Ask gently')
    state = setFlag(state, 'questions.0.required', true)
    state = setChoice(state, 'questions.0.mapsTo', '')
    expect(state.draft.questions[0]).toEqual({ id: 'a', text: 'Question a', kind: 'multi', choices: ['x'], required: true, helpText: 'Ask gently' })
    expect(setText(state, 'questions.0.helpText', '').draft.questions[0]).not.toHaveProperty('helpText')
  })

  it('drops choices and a unit the new kind cannot have, and keeps a mapping so its issue shows', () => {
    const numberQuestion = q('a', { kind: 'number', unit: 'orders/day' })
    const asChoice = setQuestionKind(initialQuestionSetForm(set(numberQuestion)), 0, 'choice')
    expect(asChoice.draft.questions[0]).toEqual({ id: 'a', text: 'Question a', kind: 'choice', choices: [], required: false })
    expect(paths(asChoice)).toEqual(['questions.0.choices'])

    const mapped = setChoice(initialQuestionSetForm(set(q('a', { kind: 'number', mapsTo: 'company.employeeCount' }))), 'questions.0.kind', 'text')
    expect(mapped.draft.questions[0]?.mapsTo).toBe('company.employeeCount')
    expect(paths(mapped)).toEqual(['questions.0.mapsTo'])
    expect(setChoice(mapped, 'questions.0.kind', 'essay')).toBe(mapped)
  })

  it('adds and removes choices', () => {
    let state = addChoice(initialQuestionSetForm(set(q('a', { kind: 'choice', choices: ['x'] }))), 0)
    expect(paths(state)).toEqual(['questions.0.choices.1'])
    state = setText(state, 'questions.0.choices.1', 'y')
    expect(state.draft.questions[0]?.choices).toEqual(['x', 'y'])
    expect(removeChoice(state, 0, 0).draft.questions[0]?.choices).toEqual(['y'])
  })

  it('refuses moving a question above the one its condition names, at that condition', () => {
    const state = initialQuestionSetForm(set(q('a', { kind: 'boolean' }), q('b', { showIf: { answerId: 'a', equals: true } })))
    expect(paths(state)).toEqual([])
    expect(paths(moveQuestion(state, 1, -1))).toEqual(['questions.0.showIf.answerId'])
  })

  it('refuses removing a question another condition names, as an unresolved reference', () => {
    const state = removeQuestion(initialQuestionSetForm(set(q('a', { kind: 'boolean' }), q('b', { showIf: { answerId: 'a', equals: true } }))), 0)
    expect(formIssues(state)).toEqual([{ path: 'questions.0.showIf.answerId', message: "No question in this set has the id 'a'" }])
  })

  it('picks suggested patterns by toggling, and drops the list when none is picked', () => {
    let state = togglePattern(initialQuestionSetForm(set(q('a'))), 0, 'pat-email-triage', true)
    expect(state.draft.questions[0]?.suggestsPatterns).toEqual(['pat-email-triage'])
    state = togglePattern(state, 0, 'pat-email-triage', false)
    expect(state.draft.questions[0]).not.toHaveProperty('suggestsPatterns')
  })
})

describe('conditions', () => {
  const base = () => initialQuestionSetForm(set(q('yn', { kind: 'boolean' }), q('n', { kind: 'number', unit: 'count' }), q('c', { kind: 'choice', choices: ['weekly', 'daily'] }), q('z')))

  it('starts a leaf with the test and value that suit the question it names', () => {
    const [yn, n, c, z] = base().draft.questions
    if (yn === undefined || n === undefined || c === undefined || z === undefined) throw new Error('fixture')
    expect(defaultLeaf(yn)).toEqual({ answerId: 'yn', equals: true })
    expect(defaultLeaf(n)).toEqual({ answerId: 'n', gt: 0 })
    expect(defaultLeaf(n, 'equals')).toEqual({ answerId: 'n', equals: 0 })
    expect(defaultLeaf(c)).toEqual({ answerId: 'c', equals: 'weekly' })
    expect(defaultLeaf(z)).toEqual({ answerId: 'z', includes: '' })
    expect(defaultLeaf({ ...c, kind: 'multi' })).toEqual({ answerId: 'c', includes: 'weekly' })
  })

  it('sets a nested condition and edits a number inside it', () => {
    let state = setConditionAt(base(), 'questions.3.showIf', { any: [{ answerId: 'yn', equals: true }, { answerId: 'n', gt: 0 }] })
    expect(paths(state)).toEqual([])
    state = setNumberText(state, 'questions.3.showIf.any.1.gt', '12,5')
    expect(state.draft.questions[3]?.showIf).toEqual({ any: [{ answerId: 'yn', equals: true }, { answerId: 'n', gt: 12.5 }] })
    expect(() => setText(state, 'questions.3.showIf.any.1.gt', '1')).toThrow('There is no text field')
  })

  it('removes a condition from its group, and the showIf at its root', () => {
    let state = setConditionAt(base(), 'questions.3.showIf', { all: [{ answerId: 'yn', equals: true }, { answerId: 'c', equals: 'daily' }] })
    state = setConditionAt(state, 'questions.3.showIf.all.0', undefined)
    expect(state.draft.questions[3]?.showIf).toEqual({ all: [{ answerId: 'c', equals: 'daily' }] })
    state = setConditionAt(state, 'questions.3.showIf', undefined)
    expect(state.draft.questions[3]).not.toHaveProperty('showIf')
    expect(() => setConditionAt(state, 'name', undefined)).toThrow('There is no condition')
  })

  it('writes a typed number in a condition only when it parses, and requires one', () => {
    const state = setConditionAt(base(), 'questions.3.showIf', { answerId: 'n', gt: 1 })
    expect(formIssues(setNumberText(state, 'questions.3.showIf.gt', 'ten'))).toEqual([{ path: 'questions.3.showIf.gt', message: NOT_A_NUMBER }])
    expect(formIssues(setNumberText(state, 'questions.3.showIf.gt', ''))).toEqual([{ path: 'questions.3.showIf.gt', message: VALUE_REQUIRED }])
  })
})

describe('located paths and saving', () => {
  it('locates every field of every question, set or not, each choice and every condition leaf', () => {
    const draft = set(q('a', { kind: 'choice', choices: ['x', 'y'] }), q('b', { showIf: { all: [{ answerId: 'a', equals: 'x' }] } }))
    const located = locatedPaths(draft)
    for (const path of ['name', 'kind', 'appliesTo.industries', 'appliesTo.minEmployees', 'questions', 'questions.0.choices.1', 'questions.1.helpText', 'questions.1.showIf', 'questions.1.showIf.all.0.equals', 'questions.1.showIf.all.0.answerId']) {
      expect(located.has(path), path).toBe(true)
    }
    // A unit shows on a number question, choices on a choice question, and either on a question that already has one.
    expect(located.has('questions.1.unit')).toBe(false)
    expect(located.has('questions.1.choices')).toBe(false)
    expect(locatedPaths(set(q('a', { unit: 'words' }))).has('questions.0.unit')).toBe(true)
    expect(locatedPaths(set(q('a', { kind: 'number' }))).has('questions.0.unit')).toBe(true)
    expect(locatedPaths(set(q('a', { choices: ['x'] }))).has('questions.0.choices.0')).toBe(true)
    expect(otherProblems(draft, [{ path: 'appliesTo.industries.0', message: 'x' }])).toHaveLength(1)
  })

  it('saves only a changed set with no issues, and counts typed text as unsaved', () => {
    const initial = initialQuestionSetForm(discovery())
    expect(canSave(setText(initial, 'name', 'Discovery, long form'))).toBe(true)
    const typed = setNumberText(initial, 'appliesTo.minEmployees', 'ten')
    expect(canSave(typed)).toBe(false)
    expect(questionSetFormView(typed, () => undefined).changed).toBe(true)
  })

  it('collects the issues under a condition group for the group to show', () => {
    const state = setConditionAt(initialQuestionSetForm(set(q('a', { kind: 'boolean' }), q('b'))), 'questions.1.showIf', { all: [{ answerId: 'a', gt: 1 }] })
    const view = questionSetFormView(state, () => undefined)
    expect(view.issuesUnder('questions.1.showIf').map((issue) => issue.path)).toEqual(['questions.1.showIf.all.0.gt'])
  })
})
