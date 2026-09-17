import { useState } from 'react'
import { canonicalJson } from '../engines/inputs-hash'
import type { Company, Contact } from '../schema/company'
import type { Answer, DiscoverySession, Question, QuestionSet } from '../schema/discovery'
import { EngagementSchema, type Engagement, type LeadSource } from '../schema/engagement'
import type { TracedValue } from '../schema/traced'
import { applyAnswer, tracedForAnswer, withDerived } from './discovery-rules'
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
// - One draft per engagement, over the slices this screen edits: company, contacts, source, tags, next
//   action and discovery sessions. Every other part of the record (caches, scope, history) is never
//   copied into the draft, so saving can never write back a stale copy of it.
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
  discovery: DiscoverySession[]
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

export type EngagementTab = 'overview' | 'company' | 'contacts' | 'discovery'

// Leaves the screen shows but does not edit, each with the reason.
export const NOT_EDITED: readonly { prefix: string; reason: string }[] = [
  { prefix: 'company.detectedStack', reason: 'Filled by signal extraction and confirmed there (Stage 1, task 10).' },
  { prefix: 'contacts.*.id', reason: 'Generated when the contact is added.' },
  { prefix: 'discovery.*.id', reason: 'Generated when the session is started.' },
  { prefix: 'discovery.*.questionSetId', reason: 'The question set is chosen when the session is started.' },
  { prefix: 'discovery.*.kind', reason: 'Taken from the question set the session runs.' },
  { prefix: 'discovery.*.completeness', reason: 'Computed from the required questions that show.' },
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
  const { company, contacts, source, tags, nextAction, discovery } = engagement
  return { company, contacts, source, tags, nextAction, discovery }
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

// A new entry starts blank, and the schema refuses a blank tag, stated tool or compliance entry, so the
// row shows its issue until it is filled in or removed.
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

// ---- Discovery sessions ---------------------------------------------------------------------------

export function sessionSetOf(sets: readonly QuestionSet[], session: DiscoverySession): QuestionSet | undefined {
  return sets.find((set) => set.id === session.questionSetId)
}

export function addSession(state: EngagementFormState, session: DiscoverySession): EngagementFormState {
  return { ...state, draft: { ...state.draft, discovery: [...state.draft.discovery, session] } }
}

export function removeSession(state: EngagementFormState, index: number): EngagementFormState {
  const discovery = state.draft.discovery.filter((_, at) => at !== index)
  return {
    ...state,
    draft: { ...state.draft, discovery },
    texts: withoutTextsUnder(state.texts, 'discovery'),
    pending: state.pending.filter((path) => !path.startsWith('discovery.')),
  }
}

export function setAttendees(state: EngagementFormState, index: number, attendees: readonly string[]): EngagementFormState {
  return withDraft(state, `discovery.${index}.attendees`, [...attendees])
}

// Every answer edit goes through here: it stores the answer, recomputes the session's completeness and
// follow-ups, and lands a mapped answer on the company at once, so the Company tab shows what was said.
// Clearing an answer leaves the company as it is: a figure already given is not unsaid by an empty box.
function withAnswer(
  state: EngagementFormState,
  sets: readonly QuestionSet[],
  sessionIndex: number,
  question: Question,
  edit: (existing: Answer | undefined) => Answer | undefined,
): EngagementFormState {
  const session = state.draft.discovery[sessionIndex]
  if (session === undefined) return state
  const existing = session.answers.find((answer) => answer.questionId === question.id)
  const next = edit(existing)
  const answers =
    next === undefined
      ? session.answers.filter((answer) => answer.questionId !== question.id)
      : existing === undefined
        ? [...session.answers, next]
        : session.answers.map((answer) => (answer.questionId === question.id ? next : answer))
  const set = sessionSetOf(sets, session)
  const edited = set === undefined ? { ...session, answers } : withDerived({ ...session, answers }, set)
  const discovery = state.draft.discovery.map((candidate, at) => (at === sessionIndex ? edited : candidate))
  const company = next === undefined ? state.draft.company : applyAnswer(state.draft.company, question, next)
  return { ...state, draft: { ...state.draft, discovery, company } }
}

function baseAnswer(question: Question, existing: Answer | undefined, id: string, value: Answer['value']): Answer {
  return {
    id: existing?.id ?? id,
    questionId: question.id,
    kind: question.kind,
    value,
    followUpTriggered: existing?.followUpTriggered ?? [],
    flags: existing?.flags ?? [],
  }
}

export function setAnswerValue(
  state: EngagementFormState,
  sets: readonly QuestionSet[],
  sessionIndex: number,
  question: Question,
  value: Answer['value'],
  id: string,
): EngagementFormState {
  return withAnswer(state, sets, sessionIndex, question, (existing) => baseAnswer(question, existing, id, value))
}

// A figure keeps its source and note, links back to this answer and is dated to the session.
export function setAnswerTraced(
  state: EngagementFormState,
  sets: readonly QuestionSet[],
  sessionIndex: number,
  question: Question,
  traced: TracedValue | null,
  id: string,
): EngagementFormState {
  const heldAt = state.draft.discovery[sessionIndex]?.heldAt ?? ''
  return withAnswer(state, sets, sessionIndex, question, (existing) => {
    // An emptied figure is no answer at all, rather than an answer with nothing in it.
    if (traced === null) return undefined
    const answerId = existing?.id ?? id
    return { ...baseAnswer(question, existing, id, traced.value), traced: tracedForAnswer(traced, answerId, heldAt) }
  })
}

// Removes the answer entirely, so nothing counts it and nothing shows a half-answer.
export function clearAnswer(state: EngagementFormState, sets: readonly QuestionSet[], sessionIndex: number, question: Question): EngagementFormState {
  return withAnswer(state, sets, sessionIndex, question, () => undefined)
}

export function toggleAnswerFlag(
  state: EngagementFormState,
  sets: readonly QuestionSet[],
  sessionIndex: number,
  question: Question,
  flag: Answer['flags'][number],
  on: boolean,
  id: string,
): EngagementFormState {
  return withAnswer(state, sets, sessionIndex, question, (existing) => {
    const base = existing ?? baseAnswer(question, undefined, id, question.kind === 'multi' ? [] : question.kind === 'boolean' ? false : question.kind === 'text' || question.kind === 'choice' ? '' : 0)
    const flags = on ? (base.flags.includes(flag) ? base.flags : [...base.flags, flag]) : base.flags.filter((candidate) => candidate !== flag)
    return { ...base, flags }
  })
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
    'discovery',
    ...draft.discovery.flatMap((session, index) => [
      `discovery.${index}.heldAt`,
      `discovery.${index}.attendees`,
      `discovery.${index}.rawNotes`,
      // An answer shows on one row, so everything about it is shown there.
      ...items(`discovery.${index}.answers`, session.answers),
    ]),
  ])
}

// An answer's row shows everything about that answer, so an issue anywhere under it is located there.
export function locatesIssue(draft: EngagementEdits, path: string): boolean {
  const located = locatedPaths(draft)
  if (located.has(path)) return true
  if (!path.startsWith('discovery.')) return false
  return [...located].some((candidate) => path.startsWith(`${candidate}.`))
}

export function otherProblems(draft: EngagementEdits, issues: readonly FormIssue[]): FormIssue[] {
  return issues.filter((issue) => !locatesIssue(draft, issue.path))
}

// Which tab a path is edited on, or null for one with no field.
export function tabOf(path: string): EngagementTab | null {
  if (path === 'source' || path === 'nextAction' || path.startsWith('nextAction.') || path === 'tags' || path.startsWith('tags.')) return 'overview'
  if (path.startsWith('company.')) return 'company'
  if (path === 'contacts' || path.startsWith('contacts.')) return 'contacts'
  if (path === 'discovery' || path.startsWith('discovery.')) return 'discovery'
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
  const tabIssues: Record<EngagementTab, number> = { overview: 0, company: 0, contacts: 0, discovery: 0 }
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
    addSession: (session: DiscoverySession) => update((current) => addSession(current, session)),
    removeSession: (index: number) => update((current) => removeSession(current, index)),
    setAttendees: (index: number, attendees: readonly string[]) => update((current) => setAttendees(current, index, attendees)),
    setAnswerValue: (sets: readonly QuestionSet[], index: number, question: Question, value: Answer['value']) => {
      const id = crypto.randomUUID()
      update((current) => setAnswerValue(current, sets, index, question, value, id))
    },
    setAnswerTraced: (sets: readonly QuestionSet[], index: number, question: Question, traced: TracedValue | null) => {
      const id = crypto.randomUUID()
      update((current) => setAnswerTraced(current, sets, index, question, traced, id))
    },
    clearAnswer: (sets: readonly QuestionSet[], index: number, question: Question) => update((current) => clearAnswer(current, sets, index, question)),
    toggleAnswerFlag: (sets: readonly QuestionSet[], index: number, question: Question, flag: Answer['flags'][number], on: boolean) => {
      const id = crypto.randomUUID()
      update((current) => toggleAnswerFlag(current, sets, index, question, flag, on, id))
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
