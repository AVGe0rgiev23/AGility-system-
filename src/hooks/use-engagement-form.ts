import { useState } from 'react'
import { canonicalJson } from '../engines/inputs-hash'
import { mergeDetectedTools } from '../engines/signals'
import type { Company, Contact, DetectedTool } from '../schema/company'
import type { Answer, DiscoverySession, Question, QuestionSet } from '../schema/discovery'
import { EngagementSchema, type Engagement, type LeadSource } from '../schema/engagement'
import type { Opportunity } from '../schema/opportunity'
import type { Process } from '../schema/process'
import type { TracedValue } from '../schema/traced'
import { applyAnswer, tracedForAnswer, withDerived } from './discovery-rules'
import {
  issuesByPath,
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
import { newIntegration, newStep, referenceIssues } from './process-rules'
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

// An opportunity as the form holds it: everything but the cached score, which is derived data the
// screen never edits. Keeping it in the draft would make every recompute look like a change to the
// stored slices and throw away an edit in progress (see receiveEngagement).
export type DraftOpportunity = Omit<Opportunity, 'scoring'>

export interface EngagementEdits {
  company: Company
  contacts: Contact[]
  source: LeadSource
  tags: string[]
  nextAction: Engagement['nextAction']
  discovery: DiscoverySession[]
  processes: Process[]
  opportunities: DraftOpportunity[]
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

export type EngagementTab = 'overview' | 'company' | 'contacts' | 'discovery' | 'processes' | 'opportunities'

// What a detected tool is, as signal extraction wrote it. Only whether it is confirmed is Alex's to change.
const SIGNAL_WRITTEN = 'Written by signal extraction. Only whether a tool is confirmed is edited here.'

// Leaves the screen shows but does not edit, each with the reason.
export const NOT_EDITED: readonly { prefix: string; reason: string }[] = [
  { prefix: 'company.detectedStack.*.name', reason: SIGNAL_WRITTEN },
  { prefix: 'company.detectedStack.*.category', reason: SIGNAL_WRITTEN },
  { prefix: 'company.detectedStack.*.confidence', reason: SIGNAL_WRITTEN },
  { prefix: 'company.detectedStack.*.evidence', reason: SIGNAL_WRITTEN },
  { prefix: 'contacts.*.id', reason: 'Generated when the contact is added.' },
  { prefix: 'discovery.*.id', reason: 'Generated when the session is started.' },
  { prefix: 'discovery.*.questionSetId', reason: 'The question set is chosen when the session is started.' },
  { prefix: 'discovery.*.kind', reason: 'Taken from the question set the session runs.' },
  { prefix: 'discovery.*.completeness', reason: 'Computed from the required questions that show.' },
  { prefix: 'processes.*.id', reason: 'Generated when the process is added.' },
  { prefix: 'processes.*.steps.*.id', reason: 'Generated when the step is added.' },
  { prefix: 'opportunities.*.id', reason: 'Generated when the opportunity is added.' },
]

const LIST_PATHS = ['contacts', 'tags', 'company.statedTools', 'company.constraints.compliance', 'company.detectedStack'] as const
type StringList =
  | 'tags'
  | 'company.statedTools'
  | 'company.constraints.compliance'
  | `processes.${number}.systemsTouched`
  | `processes.${number}.painPoints`
  | `opportunities.${number}.effortInputs.complianceFlags`

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
// A detected tool shows all five; four are read-only outputs that carry their path so their issues show on the row.
const DETECTED_FIELDS = ['name', 'category', 'confidence', 'confirmed', 'evidence'] as const
const PROCESS_FIELDS = [
  'name',
  'description',
  'owner',
  'frequency.occurrencesPerMonth',
  'frequency.minutesPerOccurrence',
  'frequency.peopleInvolved',
  'roleHourlyCost',
  'errorProfile.errorRatePercent',
  'errorProfile.costPerError',
  'errorProfile.errorDescription',
  'revenueImpact',
  'customerFacing',
] as const
const STEP_FIELDS = ['action', 'system', 'isManual', 'isBottleneck', 'waitTimeMinutes'] as const
const OPPORTUNITY_FIELDS = ['title', 'summary', 'processIds', 'patternIds', 'primaryPatternId', 'automatablePercent', 'errorReductionPercent'] as const
const EFFORT_FIELDS = ['dataReadiness', 'approvalSteps', 'volumeTier', 'novelty', 'requiresHumanInLoop'] as const
const INTEGRATION_FIELDS = ['name', 'hasPublicApi', 'authAvailable', 'notes'] as const

// Optional text and choices: clearing one removes the key, since absent is the empty value.
const OPTIONAL_TEXT =
  /^(company\.(website|locationCountry|sourceOfTruth|preferredDeliveryModel|constraints\.(dataResidency|securityNotes))|contacts\.\d+\.(role|email|phone|notes)|processes\.\d+\.(owner|errorProfile\.errorDescription|steps\.\d+\.system)|opportunities\.\d+\.effortInputs\.integrations\.\d+\.notes|opportunities\.\d+\.primaryPatternId)$/
const OPTIONAL_NUMBER = /^(company\.employeeCount|processes\.\d+\.steps\.\d+\.waitTimeMinutes)$/
// A figure the schema holds as a TracedValue, split by whether it may be cleared. Emptying a required
// one would store an engagement the schema refuses, with the issue at a path no control can fix.
const TRACED_REQUIRED = /^(processes\.\d+\.frequency\.(occurrencesPerMonth|minutesPerOccurrence|peopleInvolved)|opportunities\.\d+\.(automatablePercent|errorReductionPercent))$/
const TRACED_NULLABLE = /^(company\.blendedHourlyCost|processes\.\d+\.(roleHourlyCost|errorProfile\.(errorRatePercent|costPerError)))$/

// primaryPatternId is null rather than absent when unset, so it is not an OPTIONAL_TEXT path in the
// usual sense; setChoice handles it on its own.
const PRIMARY_PATTERN = /^opportunities\.\d+\.primaryPatternId$/

export function editsOf(engagement: Engagement): EngagementEdits {
  const { company, contacts, source, tags, nextAction, discovery, processes } = engagement
  // The cached score is left behind and re-joined on save, so a recompute is never an edit.
  const opportunities = engagement.opportunities.map(({ scoring: _cached, ...rest }) => rest)
  return { company, contacts, source, tags, nextAction, discovery, processes, opportunities }
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
  // Unset is null here, not an absent key, because the schema types it as nullable.
  if (PRIMARY_PATTERN.test(path)) return withDraft(state, path, text === '' ? null : text)
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
  const required = TRACED_REQUIRED.test(path)
  if (!required && !TRACED_NULLABLE.test(path)) throw new Error(`There is no traced field at '${path}'`)
  // TracedInput never clears a required field, so reaching here means a caller asked for a record the
  // schema refuses, with the issue at a path no control on the screen can fix.
  if (required && value === null) throw new Error(`The figure at '${path}' is required, so it cannot be cleared`)
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

// ---- Detected tools ------------------------------------------------------------------------------------

// Adds what signal extraction found that the stack does not hold, unconfirmed. An entry already there is
// never touched, so re-running cannot un-confirm a tool or overwrite the evidence it was confirmed on.
// Confirming is a flag on the row, set with setFlag.
export function applySignals(state: EngagementFormState, found: readonly DetectedTool[]): EngagementFormState {
  const stack = state.draft.company.detectedStack
  const merged = mergeDetectedTools(stack, found)
  if (merged === stack) return state
  return { ...state, draft: { ...state.draft, company: { ...state.draft.company, detectedStack: merged } } }
}

export function removeTool(state: EngagementFormState, index: number): EngagementFormState {
  const stack = state.draft.company.detectedStack
  return { ...state, draft: { ...state.draft, company: { ...state.draft.company, detectedStack: stack.filter((_, at) => at !== index) } } }
}

// ---- Processes ---------------------------------------------------------------------------------------

// A record is removed by index, so any typed text and pending flag under the list goes with it: the
// indices below it shift, and text kept by path would land on the wrong row.
function editRecords<K extends 'processes' | 'opportunities'>(state: EngagementFormState, key: K, records: EngagementEdits[K]): EngagementFormState {
  return {
    ...state,
    draft: { ...state.draft, [key]: records },
    texts: withoutTextsUnder(state.texts, key),
    pending: state.pending.filter((path) => !path.startsWith(`${key}.`)),
  }
}

function processAt(state: EngagementFormState, index: number): Process {
  const process = state.draft.processes[index]
  if (process === undefined) throw new Error(`There is no process ${String(index)}`)
  return process
}

function opportunityAt(state: EngagementFormState, index: number): DraftOpportunity {
  const opportunity = state.draft.opportunities[index]
  if (opportunity === undefined) throw new Error(`There is no opportunity ${String(index)}`)
  return opportunity
}

export function addProcess(state: EngagementFormState, process: Process): EngagementFormState {
  return { ...state, draft: { ...state.draft, processes: [...state.draft.processes, process] } }
}

export function removeProcess(state: EngagementFormState, index: number): EngagementFormState {
  return editRecords(state, 'processes', state.draft.processes.filter((_, at) => at !== index))
}

export function addStep(state: EngagementFormState, index: number, id: string): EngagementFormState {
  const process = processAt(state, index)
  return withDraft(state, `processes.${String(index)}.steps`, [...process.steps, newStep(id)])
}

export function removeStep(state: EngagementFormState, index: number, stepIndex: number): EngagementFormState {
  const process = processAt(state, index)
  const path = `processes.${String(index)}.steps`
  return { ...withDraft(state, path, process.steps.filter((_, at) => at !== stepIndex)), texts: withoutTextsUnder(state.texts, path) }
}

export function moveStep(state: EngagementFormState, index: number, stepIndex: number, offset: -1 | 1): EngagementFormState {
  const process = processAt(state, index)
  const path = `processes.${String(index)}.steps`
  return { ...withDraft(state, path, moved(process.steps, stepIndex, offset)), texts: withoutTextsUnder(state.texts, path) }
}

// ---- Opportunities -------------------------------------------------------------------------------------

export function addOpportunity(state: EngagementFormState, opportunity: DraftOpportunity): EngagementFormState {
  return { ...state, draft: { ...state.draft, opportunities: [...state.draft.opportunities, opportunity] } }
}

export function removeOpportunity(state: EngagementFormState, index: number): EngagementFormState {
  return editRecords(state, 'opportunities', state.draft.opportunities.filter((_, at) => at !== index))
}

function toggled(ids: readonly string[], id: string, on: boolean): string[] {
  if (on) return ids.includes(id) ? [...ids] : [...ids, id]
  return ids.filter((candidate) => candidate !== id)
}

export function toggleProcessLink(state: EngagementFormState, index: number, processId: string, on: boolean): EngagementFormState {
  const opportunity = opportunityAt(state, index)
  return withDraft(state, `opportunities.${String(index)}.processIds`, toggled(opportunity.processIds, processId, on))
}

// Unlinking the primary pattern clears it too: the schema refuses a primary outside the linked list,
// and leaving it would put the issue on a select whose value is no longer offered.
export function togglePatternLink(state: EngagementFormState, index: number, patternId: string, on: boolean): EngagementFormState {
  const opportunity = opportunityAt(state, index)
  const patternIds = toggled(opportunity.patternIds, patternId, on)
  const primaryPatternId = opportunity.primaryPatternId !== null && !patternIds.includes(opportunity.primaryPatternId) ? null : opportunity.primaryPatternId
  const next: DraftOpportunity = { ...opportunity, patternIds, primaryPatternId }
  return { ...state, draft: { ...state.draft, opportunities: state.draft.opportunities.map((candidate, at) => (at === index ? next : candidate)) } }
}

export function addIntegration(state: EngagementFormState, index: number): EngagementFormState {
  const opportunity = opportunityAt(state, index)
  return withDraft(state, `opportunities.${String(index)}.effortInputs.integrations`, [...opportunity.effortInputs.integrations, newIntegration()])
}

export function removeIntegration(state: EngagementFormState, index: number, integrationIndex: number): EngagementFormState {
  const opportunity = opportunityAt(state, index)
  const path = `opportunities.${String(index)}.effortInputs.integrations`
  return {
    ...withDraft(state, path, opportunity.effortInputs.integrations.filter((_, at) => at !== integrationIndex)),
    texts: withoutTextsUnder(state.texts, path),
  }
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

// The draft on top of the latest load, with each opportunity's cached score put back by id. A score the
// draft's inputs have since changed is left as it was: the recompute on the next load compares its
// inputsHash and replaces it, exactly as it does for every other cached result.
export function mergedEngagement(state: EngagementFormState): Engagement {
  const cached = new Map(state.saved.opportunities.map((opportunity) => [opportunity.id, opportunity.scoring]))
  return {
    ...state.saved,
    ...state.draft,
    // An opportunity added in this draft has no cache yet, and the schema holds the field as null
    // rather than absent.
    opportunities: state.draft.opportunities.map((opportunity) => ({ ...opportunity, scoring: cached.get(opportunity.id) ?? null })),
  }
}

export function formIssues(state: EngagementFormState): FormIssue[] {
  const typed = textIssues(state.texts, (path) => OPTIONAL_NUMBER.test(path))
  const schema = schemaIssues(EngagementSchema.safeParse(mergedEngagement(state)).error)
  // References the schema leaves to the engines, which this editor refuses to write.
  return withTextIssuesFirst(typed, [...schema, ...referenceIssues(state.draft.processes, state.draft.opportunities)])
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
    ...draft.company.detectedStack.flatMap((_, index) => DETECTED_FIELDS.map((field) => `company.detectedStack.${index}.${field}`)),
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
    'processes',
    ...draft.processes.flatMap((process, index) => {
      const at = (field: string) => `processes.${index}.${field}`
      return [
        ...PROCESS_FIELDS.map(at),
        at('steps'),
        ...process.steps.flatMap((_, stepIndex) => STEP_FIELDS.map((field) => at(`steps.${stepIndex}.${field}`))),
        at('systemsTouched'),
        ...items(at('systemsTouched'), process.systemsTouched),
        at('painPoints'),
        ...items(at('painPoints'), process.painPoints),
      ]
    }),
    'opportunities',
    ...draft.opportunities.flatMap((opportunity, index) => {
      const at = (field: string) => `opportunities.${index}.${field}`
      const effort = opportunity.effortInputs
      return [
        ...OPPORTUNITY_FIELDS.map(at),
        ...EFFORT_FIELDS.map((field) => at(`effortInputs.${field}`)),
        at('effortInputs.integrations'),
        ...effort.integrations.flatMap((_, k) => INTEGRATION_FIELDS.map((field) => at(`effortInputs.integrations.${k}.${field}`))),
        at('effortInputs.complianceFlags'),
        ...items(at('effortInputs.complianceFlags'), effort.complianceFlags),
      ]
    }),
  ])
}

// An answer's row shows everything about that answer, so an issue anywhere under it is located there.
// A rule about part of a traced figure is not: TracedInput shows only what its own draft refuses, so
// such an issue is listed under Other problems rather than pointed at a control that would not show it.
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
  if (path === 'processes' || path.startsWith('processes.')) return 'processes'
  if (path === 'opportunities' || path.startsWith('opportunities.')) return 'opportunities'
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
  const tabIssues: Record<EngagementTab, number> = { overview: 0, company: 0, contacts: 0, discovery: 0, processes: 0, opportunities: 0 }
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
    applySignals: (found: readonly DetectedTool[]) => update((current) => applySignals(current, found)),
    removeTool: (index: number) => update((current) => removeTool(current, index)),
    addProcess: (process: Process) => update((current) => addProcess(current, process)),
    removeProcess: (index: number) => update((current) => removeProcess(current, index)),
    addStep: (index: number) => {
      // Made outside the state update, which React may run twice.
      const id = crypto.randomUUID()
      update((current) => addStep(current, index, id))
    },
    removeStep: (index: number, stepIndex: number) => update((current) => removeStep(current, index, stepIndex)),
    moveStep: (index: number, stepIndex: number, offset: -1 | 1) => update((current) => moveStep(current, index, stepIndex, offset)),
    addOpportunity: (opportunity: DraftOpportunity) => update((current) => addOpportunity(current, opportunity)),
    removeOpportunity: (index: number) => update((current) => removeOpportunity(current, index)),
    toggleProcessLink: (index: number, processId: string, on: boolean) => update((current) => toggleProcessLink(current, index, processId, on)),
    togglePatternLink: (index: number, patternId: string, on: boolean) => update((current) => togglePatternLink(current, index, patternId, on)),
    addIntegration: (index: number) => update((current) => addIntegration(current, index)),
    removeIntegration: (index: number, integrationIndex: number) => update((current) => removeIntegration(current, index, integrationIndex)),
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
