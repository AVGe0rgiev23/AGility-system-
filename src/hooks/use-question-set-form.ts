import { useState } from 'react'
import { canonicalJson } from '../engines/inputs-hash'
import { ANSWER_KINDS, QuestionSetSchema, type AnswerKind, type Condition, type Question, type QuestionSet } from '../schema/discovery'
import { unresolvedReferences } from './discovery-rules'
import {
  issuesByPath,
  leafPaths,
  moved,
  numberWarnings,
  replaceAt,
  schemaIssues,
  textIssues,
  valueAt,
  withoutTextsUnder,
  withTextIssuesFirst,
  type FormIssue,
} from './form-paths'
import { parseNumberText } from './use-traced-draft'

// The editing model behind the question-set editor, as pure functions like the Settings form. Fields
// are addressed by their path within the set ('questions.2.showIf.all.0.gt'), where QuestionSetSchema
// reports, so every issue lands at its control. The schema leaves a condition naming a question outside
// the set to fail safe; this editor refuses one, so none is ever written from the app.

export interface QuestionSetFormState {
  // The set as most recently loaded.
  saved: QuestionSet
  base: QuestionSet
  draft: QuestionSet
  // Number fields typed into, as typed, by path.
  texts: Readonly<Record<string, string>>
  // Advances whenever the draft is replaced, so the screen can remount its controls.
  generation: number
}

const OPTIONAL_TEXT = /^questions\.\d+\.(helpText|unit|mapsTo)$/
const OPTIONAL_NUMBER = /^appliesTo\.minEmployees$/
const CHOICE_KINDS: readonly AnswerKind[] = ['choice', 'multi']

export function initialQuestionSetForm(set: QuestionSet, generation = 0): QuestionSetFormState {
  return { saved: set, base: set, draft: set, texts: {}, generation }
}

export function receiveQuestionSet(state: QuestionSetFormState, set: QuestionSet): QuestionSetFormState {
  if (set === state.saved) return state
  if (canonicalJson(set) !== canonicalJson(state.base)) return initialQuestionSetForm(set, state.generation + 1)
  return { ...state, saved: set }
}

export function discardQuestionSetEdits(state: QuestionSetFormState): QuestionSetFormState {
  return initialQuestionSetForm(state.saved, state.generation + 1)
}

function withDraft(state: QuestionSetFormState, path: string, next: unknown): QuestionSetFormState {
  // Every caller checks first that it replaces a value of the type already at the path.
  return { ...state, draft: replaceAt(state.draft, path, next) as QuestionSet }
}

function withQuestions(state: QuestionSetFormState, questions: Question[]): QuestionSetFormState {
  return { ...state, draft: { ...state.draft, questions }, texts: withoutTextsUnder(state.texts, 'questions') }
}

function questionAt(state: QuestionSetFormState, index: number): Question {
  const question = state.draft.questions[index]
  if (question === undefined) throw new Error(`There is no question ${index}`)
  return question
}

// ---- Fields ---------------------------------------------------------------------------------------

export function numberText(state: QuestionSetFormState, path: string): string {
  const typed = state.texts[path]
  if (typed !== undefined) return typed
  const value = valueAt(state.draft, path)
  return typeof value === 'number' ? String(value) : ''
}

export function setNumberText(state: QuestionSetFormState, path: string, text: string): QuestionSetFormState {
  const optional = OPTIONAL_NUMBER.test(path)
  const current = valueAt(state.draft, path)
  if (!(typeof current === 'number' || (optional && current === undefined))) throw new Error(`There is no number field at '${path}'`)
  const texts = { ...state.texts, [path]: text }
  const parsed = parseNumberText(text)
  if (parsed.kind === 'number') return { ...withDraft(state, path, parsed.value), texts }
  if (parsed.kind === 'empty' && optional) {
    const appliesTo = { ...state.draft.appliesTo }
    delete appliesTo.minEmployees
    return { ...state, draft: { ...state.draft, appliesTo }, texts }
  }
  return { ...state, texts }
}

export function setText(state: QuestionSetFormState, path: string, text: string): QuestionSetFormState {
  const optional = OPTIONAL_TEXT.test(path)
  const current = valueAt(state.draft, path)
  if (!(typeof current === 'string' || (optional && current === undefined))) throw new Error(`There is no text field at '${path}'`)
  return withDraft(state, path, optional && text === '' ? undefined : text)
}

// For a select: the set's kind, a question's kind, a question's path, or a condition's question.
export function setChoice(state: QuestionSetFormState, path: string, value: string): QuestionSetFormState {
  const questionKind = /^questions\.(\d+)\.kind$/.exec(path)
  if (questionKind?.[1] !== undefined) {
    const kind = ANSWER_KINDS.find((candidate) => candidate === value)
    return kind === undefined ? state : setQuestionKind(state, Number(questionKind[1]), kind)
  }
  return setText(state, path, value)
}

export function setFlag(state: QuestionSetFormState, path: string, on: boolean): QuestionSetFormState {
  if (typeof valueAt(state.draft, path) !== 'boolean') throw new Error(`There is no flag at '${path}'`)
  return withDraft(state, path, on)
}

// A kind change drops what the new kind cannot have: choices outside choice and multi, and a unit on
// anything but a number. A mapping the new kind cannot fill is kept, and its issue says so.
export function setQuestionKind(state: QuestionSetFormState, index: number, kind: AnswerKind): QuestionSetFormState {
  const { choices, unit, ...rest } = questionAt(state, index)
  const next: Question = {
    ...rest,
    kind,
    ...(CHOICE_KINDS.includes(kind) ? { choices: choices ?? [] } : {}),
    ...(kind === 'number' && unit !== undefined ? { unit } : {}),
  }
  const questions = state.draft.questions.map((question, at) => (at === index ? next : question))
  return { ...state, draft: { ...state.draft, questions }, texts: withoutTextsUnder(state.texts, `questions.${index}`) }
}

// Industries and suggested patterns are picked from a list, so each is a toggle rather than typed text.
export function toggleIndustry(state: QuestionSetFormState, industry: string, on: boolean): QuestionSetFormState {
  const current = state.draft.appliesTo.industries ?? []
  const industries = on ? (current.includes(industry) ? current : [...current, industry]) : current.filter((item) => item !== industry)
  const appliesTo = { ...state.draft.appliesTo }
  if (industries.length === 0) delete appliesTo.industries
  else appliesTo.industries = industries
  return { ...state, draft: { ...state.draft, appliesTo } }
}

export function togglePattern(state: QuestionSetFormState, index: number, patternId: string, on: boolean): QuestionSetFormState {
  const { suggestsPatterns, ...rest } = questionAt(state, index)
  const current = suggestsPatterns ?? []
  const patterns = on ? (current.includes(patternId) ? current : [...current, patternId]) : current.filter((item) => item !== patternId)
  const next: Question = patterns.length === 0 ? rest : { ...rest, suggestsPatterns: patterns }
  return { ...state, draft: { ...state.draft, questions: state.draft.questions.map((question, at) => (at === index ? next : question)) } }
}

// ---- Questions and choices ------------------------------------------------------------------------

export function addQuestion(state: QuestionSetFormState, id: string): QuestionSetFormState {
  return withQuestions(state, [...state.draft.questions, { id, text: '', kind: 'text', required: false }])
}

// A condition naming a removed question is refused until it is changed, so nothing is removed silently.
export function removeQuestion(state: QuestionSetFormState, index: number): QuestionSetFormState {
  return withQuestions(
    state,
    state.draft.questions.filter((_, at) => at !== index),
  )
}

// Moving a question above one its condition names is refused by the schema at that condition.
export function moveQuestion(state: QuestionSetFormState, index: number, offset: -1 | 1): QuestionSetFormState {
  return withQuestions(state, moved(state.draft.questions, index, offset))
}

export function addChoice(state: QuestionSetFormState, index: number): QuestionSetFormState {
  const question = questionAt(state, index)
  return withDraft(state, `questions.${index}.choices`, [...(question.choices ?? []), ''])
}

export function removeChoice(state: QuestionSetFormState, index: number, choiceIndex: number): QuestionSetFormState {
  const question = questionAt(state, index)
  return withDraft(state, `questions.${index}.choices`, (question.choices ?? []).filter((_, at) => at !== choiceIndex))
}

// ---- Conditions -----------------------------------------------------------------------------------

export type ConditionTest = 'equals' | 'gt' | 'includes'

// The first test that suits a question's kind, with a starting value, so a new leaf is always valid in
// shape; the person then picks the value they mean.
export function defaultLeaf(question: Question, test?: ConditionTest): Condition {
  const kind = question.kind
  const firstChoice = question.choices?.[0] ?? ''
  const chosen: ConditionTest = test ?? (kind === 'number' || kind === 'duration' ? 'gt' : kind === 'multi' || kind === 'text' ? 'includes' : 'equals')
  if (chosen === 'gt') return { answerId: question.id, gt: 0 }
  if (chosen === 'includes') return { answerId: question.id, includes: kind === 'multi' ? firstChoice : '' }
  if (kind === 'boolean') return { answerId: question.id, equals: true }
  if (kind === 'number' || kind === 'duration') return { answerId: question.id, equals: 0 }
  return { answerId: question.id, equals: firstChoice }
}

// Replaces the condition at a path ('questions.3.showIf' or one inside it), or removes it: from a
// group's list, or the whole showIf at the root.
export function setConditionAt(state: QuestionSetFormState, path: string, condition: Condition | undefined): QuestionSetFormState {
  const root = /^questions\.(\d+)\.showIf/.exec(path)
  if (root?.[1] === undefined) throw new Error(`There is no condition at '${path}'`)
  const questionPath = `questions.${root[1]}.showIf`
  const texts = withoutTextsUnder(state.texts, path)
  if (condition !== undefined) return { ...withDraft(state, path, condition), texts }
  if (path === questionPath) {
    const { showIf: _removed, ...rest } = questionAt(state, Number(root[1]))
    return { ...state, draft: { ...state.draft, questions: state.draft.questions.map((question, at) => (at === Number(root[1]) ? rest : question)) }, texts }
  }
  const child = /^(.*)\.(\d+)$/.exec(path)
  const listPath = child?.[1]
  const list = listPath === undefined ? undefined : valueAt(state.draft, listPath)
  if (listPath === undefined || child?.[2] === undefined || !Array.isArray(list)) throw new Error(`There is no condition to remove at '${path}'`)
  return { ...withDraft(state, listPath, (list as unknown[]).filter((_, at) => at !== Number(child[2]))), texts: withoutTextsUnder(state.texts, listPath) }
}

// ---- Issues and saving ----------------------------------------------------------------------------

export function formIssues(state: QuestionSetFormState): FormIssue[] {
  const typed = textIssues(state.texts, (path) => OPTIONAL_NUMBER.test(path))
  const schema = [...schemaIssues(QuestionSetSchema.safeParse(state.draft).error), ...unresolvedReferences(state.draft)]
  return withTextIssuesFirst(typed, schema)
}

const QUESTION_FIELDS = ['id', 'text', 'kind', 'required', 'helpText', 'unit', 'mapsTo', 'choices', 'suggestsPatterns', 'showIf'] as const

// Every path the editor shows issues at: the set's fields, each question's fields whether set or not,
// each choice, and every leaf of each condition. Industries and patterns are picked from lists, so their
// issues show at the list.
export function locatedPaths(draft: QuestionSet): Set<string> {
  const conditionLeaves = draft.questions.flatMap((question, index) => (question.showIf === undefined ? [] : leafPaths(question.showIf, `questions.${index}.showIf`)))
  return new Set([
    'name',
    'kind',
    'appliesTo.industries',
    'appliesTo.minEmployees',
    'questions',
    ...draft.questions.flatMap((question, index) => [
      ...QUESTION_FIELDS.map((field) => `questions.${index}.${field}`),
      ...(question.choices ?? []).map((_, choiceIndex) => `questions.${index}.choices.${choiceIndex}`),
    ]),
    ...conditionLeaves,
  ])
}

export function otherProblems(draft: QuestionSet, issues: readonly FormIssue[]): FormIssue[] {
  const located = locatedPaths(draft)
  return issues.filter((issue) => !located.has(issue.path))
}

export function hasChanges(state: QuestionSetFormState): boolean {
  return canonicalJson(state.draft) !== canonicalJson(state.base)
}

export function canSave(state: QuestionSetFormState): boolean {
  return hasChanges(state) && formIssues(state).length === 0
}

// ---- Hook -----------------------------------------------------------------------------------------

type Update = (edit: (current: QuestionSetFormState) => QuestionSetFormState) => void

export function questionSetFormView(state: QuestionSetFormState, update: Update) {
  const issues = formIssues(state)
  const byPath = issuesByPath(issues)
  const at = (path: string) => valueAt(state.draft, path)
  const typedIssues = textIssues(state.texts, (path) => OPTIONAL_NUMBER.test(path))
  return {
    state,
    draft: state.draft,
    issues,
    otherProblems: otherProblems(state.draft, issues),
    changed: hasChanges(state) || typedIssues.length > 0,
    canSave: canSave(state),
    issuesAt: (path: string): readonly string[] => byPath.get(path) ?? [],
    // Issues anywhere under a path, for a condition group that has no single field to show them at.
    issuesUnder: (path: string): FormIssue[] => issues.filter((issue) => issue.path === path || issue.path.startsWith(`${path}.`)),
    numberText: (path: string) => numberText(state, path),
    numberReading: (path: string) => {
      const parsed = parseNumberText(numberText(state, path))
      return parsed.kind === 'number' ? parsed.value : null
    },
    numberWarnings: (path: string) => numberWarnings(numberText(state, path)),
    textAt: (path: string): string => {
      const value = at(path)
      return typeof value === 'string' ? value : ''
    },
    flagAt: (path: string): boolean => at(path) === true,
    valueAt: at,
    setNumberText: (path: string, text: string) => update((current) => setNumberText(current, path, text)),
    setText: (path: string, text: string) => update((current) => setText(current, path, text)),
    setChoice: (path: string, value: string) => update((current) => setChoice(current, path, value)),
    setFlag: (path: string, on: boolean) => update((current) => setFlag(current, path, on)),
    toggleIndustry: (industry: string, on: boolean) => update((current) => toggleIndustry(current, industry, on)),
    togglePattern: (index: number, patternId: string, on: boolean) => update((current) => togglePattern(current, index, patternId, on)),
    addQuestion: () => {
      // Made outside the state update, which React may run twice.
      const id = `q-${crypto.randomUUID().slice(0, 8)}`
      update((current) => addQuestion(current, id))
    },
    removeQuestion: (index: number) => update((current) => removeQuestion(current, index)),
    moveQuestion: (index: number, offset: -1 | 1) => update((current) => moveQuestion(current, index, offset)),
    addChoice: (index: number) => update((current) => addChoice(current, index)),
    removeChoice: (index: number, choiceIndex: number) => update((current) => removeChoice(current, index, choiceIndex)),
    setConditionAt: (path: string, condition: Condition | undefined) => update((current) => setConditionAt(current, path, condition)),
    discard: () => update(discardQuestionSetEdits),
  }
}

export type QuestionSetFormView = ReturnType<typeof questionSetFormView>

export function useQuestionSetForm(set: QuestionSet): QuestionSetFormView {
  const [stored, setStored] = useState(() => initialQuestionSetForm(set))
  const state = stored.saved.id === set.id ? receiveQuestionSet(stored, set) : initialQuestionSetForm(set)
  if (state !== stored) setStored(state)
  return questionSetFormView(state, setStored)
}
