import { useState } from 'react'
import { canonicalJson } from '../engines/inputs-hash'
import type { Company, Contact } from '../schema/company'
import { EngagementSchema, type Engagement, type LeadSource } from '../schema/engagement'
import type { TracedValue } from '../schema/traced'
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

// The editing model behind the engagement detail, as pure functions like the Settings form.
//
// - One draft per engagement, over the slices this screen edits: company, contacts, source, tags and
//   next action. Every other part of the record (caches, discovery, scope, history) is never copied into
//   the draft, so saving can never write back a stale copy of it.
// - Fields are addressed by the engagement's own paths ('company.name', 'contacts.0.email'), which is
//   where EngagementSchema reports, so every issue lands at its control.
// - The draft is replaced only when the stored slices change from what it was started from. A reload
//   that only recomputes cached results leaves an edit alone.

export interface EngagementEdits {
  company: Company
  contacts: Contact[]
  source: LeadSource
  tags: string[]
  nextAction: Engagement['nextAction']
}

export interface EngagementFormState {
  // The engagement as most recently loaded. Saving puts the draft on top of it.
  saved: Engagement
  // The slices as they were when the draft was started.
  base: EngagementEdits
  draft: EngagementEdits
  // Number fields typed into, as typed, by path.
  texts: Readonly<Record<string, string>>
  // Traced fields whose text on screen is invalid, so has not reached the draft.
  pending: readonly string[]
  // Advances whenever the draft is replaced, so the screen can remount its controls: a TracedInput holding
  // invalid text would otherwise keep showing it over the value it was reset to.
  generation: number
}

export type EngagementTab = 'overview' | 'company' | 'contacts'

// Leaves the screen shows but does not edit, each with the reason.
export const NOT_EDITED: readonly { prefix: string; reason: string }[] = [
  { prefix: 'company.detectedStack', reason: 'Filled by signal extraction and confirmed there (Stage 1, task 10).' },
  { prefix: 'contacts.*.id', reason: 'Generated when the contact is added.' },
]

const LIST_PATHS = ['contacts', 'tags', 'company.statedTools', 'company.constraints.compliance', 'company.detectedStack'] as const
type StringList = 'tags' | 'company.statedTools' | 'company.constraints.compliance'

const COMPANY_FIELDS = [
  'name',
  'website',
  'industry',
  'employeeCount',
  'locationCountry',
  'currency',
  'blendedHourlyCost',
  'sourceOfTruth',
  'constraints.dataResidency',
  'constraints.securityNotes',
  'preferredDeliveryModel',
] as const
const CONTACT_FIELDS = ['name', 'role', 'email', 'phone', 'isDecisionMaker', 'notes'] as const

// Optional text and choices: clearing one removes the key, since absent is the empty value.
const OPTIONAL_TEXT =
  /^(company\.(website|locationCountry|sourceOfTruth|preferredDeliveryModel|constraints\.(dataResidency|securityNotes))|contacts\.\d+\.(role|email|phone|notes))$/
const OPTIONAL_NUMBER = /^company\.employeeCount$/
const TRACED = /^company\.blendedHourlyCost$/

export function editsOf(engagement: Engagement): EngagementEdits {
  const { company, contacts, source, tags, nextAction } = engagement
  return { company, contacts, source, tags, nextAction }
}

export function initialEngagementForm(engagement: Engagement, generation = 0): EngagementFormState {
  const edits = editsOf(engagement)
  return { saved: engagement, base: edits, draft: edits, texts: {}, pending: [], generation }
}

// Called with the loaded engagement on every render. Returns the same state when nothing changed.
export function receiveEngagement(state: EngagementFormState, engagement: Engagement): EngagementFormState {
  if (engagement === state.saved) return state
  if (canonicalJson(editsOf(engagement)) !== canonicalJson(state.base)) return initialEngagementForm(engagement, state.generation + 1)
  return { ...state, saved: engagement }
}

export function discardEngagementEdits(state: EngagementFormState): EngagementFormState {
  return initialEngagementForm(state.saved, state.generation + 1)
}

function withDraft(state: EngagementFormState, path: string, next: unknown): EngagementFormState {
  // Every caller checks first that it replaces a value of the type already at the path.
  return { ...state, draft: replaceAt(state.draft, path, next) as EngagementEdits }
}

// ---- Fields ---------------------------------------------------------------------------------------

export function numberText(state: EngagementFormState, path: string): string {
  const typed = state.texts[path]
  if (typed !== undefined) return typed
  const value = valueAt(state.draft, path)
  return typeof value === 'number' ? String(value) : ''
}

export function setNumberText(state: EngagementFormState, path: string, text: string): EngagementFormState {
  const optional = OPTIONAL_NUMBER.test(path)
  const current = valueAt(state.draft, path)
  if (!(typeof current === 'number' || (optional && current === undefined))) throw new Error(`There is no number field at '${path}'`)
  const texts = { ...state.texts, [path]: text }
  const parsed = parseNumberText(text)
  if (parsed.kind === 'number') return { ...withDraft(state, path, parsed.value), texts }
  if (parsed.kind === 'empty' && optional) return { ...withDraft(state, path, undefined), texts }
  return { ...state, texts }
}

// A next action is either absent or has text; both boxes empty means none.
function setNextAction(state: EngagementFormState, key: 'text' | 'due', value: string): EngagementFormState {
  const current = state.draft.nextAction
  const text = key === 'text' ? value : (current?.text ?? '')
  const due = key === 'due' ? value : (current?.due ?? '')
  const nextAction = text === '' && due === '' ? null : { text, ...(due === '' ? {} : { due }) }
  return { ...state, draft: { ...state.draft, nextAction } }
}

export function setText(state: EngagementFormState, path: string, text: string): EngagementFormState {
  if (path === 'nextAction.text' || path === 'nextAction.due') return setNextAction(state, path === 'nextAction.text' ? 'text' : 'due', text)
  const optional = OPTIONAL_TEXT.test(path)
  const current = valueAt(state.draft, path)
  if (!(typeof current === 'string' || (optional && current === undefined))) throw new Error(`There is no text field at '${path}'`)
  return withDraft(state, path, optional && text === '' ? undefined : text)
}

// For a select. The caller passes one of the schema's options, or '' on an optional choice for none.
export const setChoice = setText

export function setFlag(state: EngagementFormState, path: string, on: boolean): EngagementFormState {
  if (typeof valueAt(state.draft, path) !== 'boolean') throw new Error(`There is no flag at '${path}'`)
  return withDraft(state, path, on)
}

export function setTraced(state: EngagementFormState, path: string, value: TracedValue | null): EngagementFormState {
  if (!TRACED.test(path)) throw new Error(`There is no traced field at '${path}'`)
  return withDraft(state, path, value)
}

export function setPending(state: EngagementFormState, path: string, pending: boolean): EngagementFormState {
  const others = state.pending.filter((existing) => existing !== path)
  const next = pending ? [...others, path] : others
  return next.length === state.pending.length && next.every((existing, index) => existing === state.pending[index]) ? state : { ...state, pending: next }
}

// ---- Lists ----------------------------------------------------------------------------------------

function listAt(state: EngagementFormState, path: string): unknown[] {
  const list = valueAt(state.draft, path)
  if (!Array.isArray(list)) throw new Error(`There is no list at '${path}'`)
  return list as unknown[]
}

function editList(state: EngagementFormState, path: string, items: unknown[]): EngagementFormState {
  return {
    ...withDraft(state, path, items),
    texts: withoutTextsUnder(state.texts, path),
    pending: state.pending.filter((existing) => !existing.startsWith(`${path}.`)),
  }
}

// A new entry starts blank. A blank tag is refused by the schema; a blank stated tool or compliance
// entry is not, and saves as typed.
export function addToList(state: EngagementFormState, path: StringList): EngagementFormState {
  return editList(state, path, [...listAt(state, path), ''])
}

export function addContact(state: EngagementFormState, id: string): EngagementFormState {
  const contact: Contact = { id, name: '', isDecisionMaker: false }
  return editList(state, 'contacts', [...listAt(state, 'contacts'), contact])
}

export function removeFromList(state: EngagementFormState, path: StringList | 'contacts', index: number): EngagementFormState {
  return editList(state, path, listAt(state, path).filter((_, at) => at !== index))
}

// ---- Issues and saving ----------------------------------------------------------------------------

export function mergedEngagement(state: EngagementFormState): Engagement {
  return { ...state.saved, ...state.draft }
}

export function formIssues(state: EngagementFormState): FormIssue[] {
  const typed = textIssues(state.texts, (path) => OPTIONAL_NUMBER.test(path))
  return withTextIssuesFirst(typed, schemaIssues(EngagementSchema.safeParse(mergedEngagement(state)).error))
}

// Every path the screen shows issues at. The every-field render test holds the tabs to exactly this set.
export function locatedPaths(draft: EngagementEdits): Set<string> {
  const items = (path: string, list: readonly unknown[]) => list.map((_, index) => `${path}.${index}`)
  return new Set([
    ...COMPANY_FIELDS.map((field) => `company.${field}`),
    'source',
    'nextAction.text',
    'nextAction.due',
    ...LIST_PATHS,
    ...draft.contacts.flatMap((_, index) => CONTACT_FIELDS.map((field) => `contacts.${index}.${field}`)),
    ...items('tags', draft.tags),
    ...items('company.statedTools', draft.company.statedTools),
    ...items('company.constraints.compliance', draft.company.constraints.compliance),
  ])
}

export function otherProblems(draft: EngagementEdits, issues: readonly FormIssue[]): FormIssue[] {
  const located = locatedPaths(draft)
  return issues.filter((issue) => !located.has(issue.path))
}

// Which tab a path is edited on, or null for one with no field.
export function tabOf(path: string): EngagementTab | null {
  if (path === 'source' || path === 'nextAction' || path.startsWith('nextAction.') || path === 'tags' || path.startsWith('tags.')) return 'overview'
  if (path.startsWith('company.')) return 'company'
  if (path === 'contacts' || path.startsWith('contacts.')) return 'contacts'
  return null
}

export function hasChanges(state: EngagementFormState): boolean {
  return canonicalJson(state.draft) !== canonicalJson(state.base)
}

export function hasUnsavedEdits(state: EngagementFormState): boolean {
  return hasChanges(state) || textIssues(state.texts, (path) => OPTIONAL_NUMBER.test(path)).length > 0 || state.pending.length > 0
}

export function canSave(state: EngagementFormState): boolean {
  return hasChanges(state) && state.pending.length === 0 && formIssues(state).length === 0
}

// ---- Hook -----------------------------------------------------------------------------------------

type Update = (edit: (current: EngagementFormState) => EngagementFormState) => void

// What the engagement detail reads and calls, built from any state, so a render test can show a state
// that only typing could otherwise reach.
export function engagementFormView(state: EngagementFormState, update: Update) {
  const issues = formIssues(state)
  const byPath = issuesByPath(issues)
  const at = (path: string) => valueAt(state.draft, path)
  const tabIssues: Record<EngagementTab, number> = { overview: 0, company: 0, contacts: 0 }
  for (const issue of issues) {
    const tab = tabOf(issue.path)
    if (tab !== null) tabIssues[tab]++
  }

  return {
    state,
    draft: state.draft,
    saved: state.saved,
    issues,
    otherProblems: otherProblems(state.draft, issues),
    // Pending traced fields block saving as much as issues do.
    problems: issues.length + state.pending.length,
    tabIssues,
    changed: hasUnsavedEdits(state),
    canSave: canSave(state),
    merged: () => mergedEngagement(state),
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
    flagAt: (path: string): boolean => at(path) === true,
    valueAt: at,
    tracedAt: (path: string): TracedValue | null => {
      const value = at(path)
      // The only traced path is a nullable TracedValue in a draft whose types are always valid.
      return value === undefined ? null : (value as TracedValue | null)
    },
    setNumberText: (path: string, text: string) => update((current) => setNumberText(current, path, text)),
    setText: (path: string, text: string) => update((current) => setText(current, path, text)),
    setChoice: (path: string, value: string) => update((current) => setChoice(current, path, value)),
    setFlag: (path: string, on: boolean) => update((current) => setFlag(current, path, on)),
    setTraced: (path: string, value: TracedValue | null) => update((current) => setTraced(current, path, value)),
    setPending: (path: string, pending: boolean) => update((current) => setPending(current, path, pending)),
    addToList: (path: StringList) => update((current) => addToList(current, path)),
    removeFromList: (path: StringList | 'contacts', index: number) => update((current) => removeFromList(current, path, index)),
    addContact: () => {
      // Made outside the state update, which React may run twice.
      const id = crypto.randomUUID()
      update((current) => addContact(current, id))
    },
    discard: () => update(discardEngagementEdits),
  }
}

export type EngagementFormView = ReturnType<typeof engagementFormView>

export function useEngagementForm(engagement: Engagement): EngagementFormView {
  const [stored, setStored] = useState(() => initialEngagementForm(engagement))
  // A different engagement, or this one saved or replaced, starts the form again; a recompute does not.
  const state = stored.saved.id === engagement.id ? receiveEngagement(stored, engagement) : initialEngagementForm(engagement)
  if (state !== stored) setStored(state)
  return engagementFormView(state, setStored)
}
