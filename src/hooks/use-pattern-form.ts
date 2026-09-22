import { useState } from 'react'
import { canonicalJson } from '../engines/inputs-hash'
import { PatternSchema, type Pattern } from '../schema/library'
import {
  issuesByPath,
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

// The editing model behind the pattern editor, as pure functions like the question-set form. Fields are
// addressed by their path on the record ('requiredIntegrations.2'), where PatternSchema reports, so
// every issue lands at its control. Pattern is flat, unlike a question set: it has no nested array of
// conditionally-shaped items, only the two string lists, so there is no editor-only reference check to
// make (Pattern names nothing else in the Library).

export interface PatternFormState {
  saved: Pattern
  base: Pattern
  draft: Pattern
  // Number field text typed, as typed, by path. Pattern has one: baseHours.
  texts: Readonly<Record<string, string>>
  // Advances whenever the draft is replaced, so the screen can remount its controls.
  generation: number
}

export type PatternStringList = 'requiredIntegrations' | 'risks'
const STRING_LISTS: readonly PatternStringList[] = ['requiredIntegrations', 'risks']

export function initialPatternForm(pattern: Pattern, generation = 0): PatternFormState {
  return { saved: pattern, base: pattern, draft: pattern, texts: {}, generation }
}

export function receivePattern(state: PatternFormState, pattern: Pattern): PatternFormState {
  if (pattern === state.saved) return state
  if (canonicalJson(pattern) !== canonicalJson(state.base)) return initialPatternForm(pattern, state.generation + 1)
  return { ...state, saved: pattern }
}

export function discardPatternEdits(state: PatternFormState): PatternFormState {
  return initialPatternForm(state.saved, state.generation + 1)
}

function withDraft(state: PatternFormState, path: string, next: unknown): PatternFormState {
  // Every caller checks first that it replaces a value of the type already at the path.
  return { ...state, draft: replaceAt(state.draft, path, next) as Pattern }
}

// ---- Fields ---------------------------------------------------------------------------------------

export function numberText(state: PatternFormState, path: string): string {
  const typed = state.texts[path]
  if (typed !== undefined) return typed
  const value = valueAt(state.draft, path)
  return typeof value === 'number' ? String(value) : ''
}

// baseHours is the only number field, and it is never optional: a pattern with no build-hours
// estimate has nothing to price with, so clearing it leaves the draft as it was and blocks saving,
// exactly like any other required figure.
export function setNumberText(state: PatternFormState, path: string, text: string): PatternFormState {
  const current = valueAt(state.draft, path)
  if (typeof current !== 'number') throw new Error(`There is no number field at '${path}'`)
  const texts = { ...state.texts, [path]: text }
  const parsed = parseNumberText(text)
  if (parsed.kind === 'number') return { ...withDraft(state, path, parsed.value), texts }
  return { ...state, texts }
}

export function setText(state: PatternFormState, path: string, text: string): PatternFormState {
  const current = valueAt(state.draft, path)
  if (typeof current !== 'string') throw new Error(`There is no text field at '${path}'`)
  return withDraft(state, path, text)
}

// For a select: only complexity today.
export const setChoice = setText

// ---- Lists ------------------------------------------------------------------------------------------

function listAt(state: PatternFormState, path: PatternStringList): string[] {
  const list = state.draft[path]
  if (!Array.isArray(list)) throw new Error(`There is no list at '${path}'`)
  return list
}

// A new entry starts blank; PatternSchema places no rule on these lists (see the design question in
// the implementation report), so a blank one saves as it is until it is filled in or removed.
export function addToList(state: PatternFormState, path: PatternStringList): PatternFormState {
  return withDraft(state, path, [...listAt(state, path), ''])
}

export function removeFromList(state: PatternFormState, path: PatternStringList, index: number): PatternFormState {
  return { ...withDraft(state, path, listAt(state, path).filter((_, at) => at !== index)), texts: withoutTextsUnder(state.texts, path) }
}

// ---- Issues and saving ----------------------------------------------------------------------------

export function formIssues(state: PatternFormState): FormIssue[] {
  const typed = textIssues(state.texts, () => false)
  const schema = schemaIssues(PatternSchema.safeParse(state.draft).error)
  return withTextIssuesFirst(typed, schema)
}

// Every path the editor shows issues at: every field, whether set or not, and every list item.
export function locatedPaths(draft: Pattern): Set<string> {
  return new Set([
    'name',
    'category',
    'problem',
    'solution',
    'architecture',
    'complexity',
    'baseHours',
    'clientExplanation',
    'codeNotes',
    ...STRING_LISTS.flatMap((path) => [path, ...draft[path].map((_, index) => `${path}.${index}`)]),
  ])
}

export function otherProblems(draft: Pattern, issues: readonly FormIssue[]): FormIssue[] {
  const located = locatedPaths(draft)
  return issues.filter((issue) => !located.has(issue.path))
}

export function hasChanges(state: PatternFormState): boolean {
  return canonicalJson(state.draft) !== canonicalJson(state.base)
}

export function canSave(state: PatternFormState): boolean {
  return hasChanges(state) && formIssues(state).length === 0
}

// ---- Hook -----------------------------------------------------------------------------------------

type Update = (edit: (current: PatternFormState) => PatternFormState) => void

export function patternFormView(state: PatternFormState, update: Update) {
  const issues = formIssues(state)
  const byPath = issuesByPath(issues)
  const at = (path: string) => valueAt(state.draft, path)
  const typedIssues = textIssues(state.texts, () => false)
  return {
    state,
    draft: state.draft,
    issues,
    otherProblems: otherProblems(state.draft, issues),
    changed: hasChanges(state) || typedIssues.length > 0,
    canSave: canSave(state),
    issuesAt: (path: string): readonly string[] => byPath.get(path) ?? [],
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
    // Pattern has no boolean field. Kept so the view satisfies the PathForm shape every shared
    // control expects; nothing on this screen can reach either.
    flagAt: (): boolean => false,
    setFlag: (path: string): never => {
      throw new Error(`There is no flag at '${path}'`)
    },
    valueAt: at,
    setNumberText: (path: string, text: string) => update((current) => setNumberText(current, path, text)),
    setText: (path: string, text: string) => update((current) => setText(current, path, text)),
    setChoice: (path: string, value: string) => update((current) => setChoice(current, path, value)),
    addToList: (path: PatternStringList) => update((current) => addToList(current, path)),
    removeFromList: (path: PatternStringList, index: number) => update((current) => removeFromList(current, path, index)),
    discard: () => update(discardPatternEdits),
  }
}

export type PatternFormView = ReturnType<typeof patternFormView>

export function usePatternForm(pattern: Pattern): PatternFormView {
  const [stored, setStored] = useState(() => initialPatternForm(pattern))
  const state = stored.saved.id === pattern.id ? receivePattern(stored, pattern) : initialPatternForm(pattern)
  if (state !== stored) setStored(state)
  return patternFormView(state, setStored)
}
