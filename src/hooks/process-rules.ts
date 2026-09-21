import type { DiscoverySession, QuestionSet } from '../schema/discovery'
import { MAPPING_TARGETS } from '../schema/discovery'
import type { EffortInputs, Opportunity } from '../schema/opportunity'
import type { Process, ProcessStep } from '../schema/process'
import type { ProjectScope } from '../schema/scope'
import type { TracedValue } from '../schema/traced'
import { isAnswered } from './discovery-rules'
import type { FormIssue } from './form-paths'

// The rules of process mapping and opportunity capture, as pure functions like discovery-rules.
//
// Two kinds of rule live here rather than in the schema. A reference the engines already tolerate (an
// opportunity naming a process that is gone raises MISSING_PROCESS and contributes nothing) would push
// a whole engagement out of the app if the schema refused it on import, so the editor refuses to write
// one instead. And what a new record needs before it can exist at all is a rule about a form, not about
// stored data: every figure the schema requires is collected before the record is made, so nothing
// starts as a silent zero or a source nobody chose.

// ---- What each figure is recorded in ---------------------------------------------------------------

// A share of a whole. Scoring divides each by 100, so past their whole they would recover more work,
// or prevent more errors, than there is.
const PERCENT = { unit: 'percent', max: 100 } as const

// Split, because only a process figure is a field a session can be carried into.
export type ProcessFigureField = 'occurrencesPerMonth' | 'minutesPerOccurrence' | 'peopleInvolved' | 'roleHourlyCost' | 'errorRatePercent' | 'costPerError'
export type FigureField = ProcessFigureField | 'automatablePercent' | 'errorReductionPercent'

// What TracedInput needs: a plain unit, with an optional bound, or money in the company's currency,
// per a unit of time when `per` is set.
export type FigureMeasure = { unit: string; max?: number; money?: undefined; per?: undefined } | { money: true; per?: string; unit?: undefined; max?: undefined }

// Every unit a discovery answer can land on comes from MAPPING_TARGETS, so a figure typed on these
// screens and the same figure given in a session are recorded in exactly one unit.
const MAPPED: Readonly<Record<string, FigureMeasure>> = {
  occurrencesPerMonth: measureOfPath('process.frequency.occurrencesPerMonth'),
  minutesPerOccurrence: measureOfPath('process.frequency.minutesPerOccurrence'),
  peopleInvolved: measureOfPath('process.frequency.peopleInvolved'),
  roleHourlyCost: measureOfPath('process.roleHourlyCost'),
  costPerError: measureOfPath('process.errorProfile.costPerError'),
}

function measureOfPath(path: keyof typeof MAPPING_TARGETS): FigureMeasure {
  const { measure } = MAPPING_TARGETS[path]
  // Every path named here declares one; MAPPING_TARGETS is the single source and this would be a typo.
  if (measure === undefined) throw new Error(`'${path}' records no figure`)
  return measure.money === true ? { money: true, ...(measure.per === undefined ? {} : { per: measure.per }) } : { unit: measure.unit }
}

export function figureMeasure(field: FigureField): FigureMeasure {
  // A share is bounded here rather than in MAPPING_TARGETS, which says what an answer is recorded in
  // and not what a valid one is.
  if (field === 'errorRatePercent' || field === 'automatablePercent' || field === 'errorReductionPercent') return { ...PERCENT }
  const measure = MAPPED[field]
  if (measure === undefined) throw new Error(`'${field}' records no figure`)
  return measure
}

// ---- A new process ---------------------------------------------------------------------------------

export type RevenueImpact = Process['revenueImpact']

export interface NewProcessDraft {
  name: string
  description: string
  owner: string
  occurrencesPerMonth: TracedValue | null
  minutesPerOccurrence: TracedValue | null
  peopleInvolved: TracedValue | null
  roleHourlyCost: TracedValue | null
  errorRatePercent: TracedValue | null
  costPerError: TracedValue | null
  // Empty until chosen: there is no neutral revenue impact, and 'none' is an answer rather than a default.
  revenueImpact: RevenueImpact | ''
  customerFacing: boolean
  // The session the figures were carried from, so the panel can say where they came from.
  fromSessionId: string | null
}

export function initialProcessDraft(): NewProcessDraft {
  return {
    name: '',
    description: '',
    owner: '',
    occurrencesPerMonth: null,
    minutesPerOccurrence: null,
    peopleInvolved: null,
    roleHourlyCost: null,
    errorRatePercent: null,
    costPerError: null,
    revenueImpact: '',
    customerFacing: false,
    fromSessionId: null,
  }
}

export function processDraftIssues(draft: NewProcessDraft): FormIssue[] {
  const issues: FormIssue[] = []
  if (draft.name.trim() === '') issues.push({ path: 'name', message: 'A process needs a name' })
  // The schema holds all three, because scoring multiplies them into the hours a process wastes.
  const figures = [
    { path: 'occurrencesPerMonth', value: draft.occurrencesPerMonth, message: 'How often it runs is needed' },
    { path: 'minutesPerOccurrence', value: draft.minutesPerOccurrence, message: 'How long one run takes is needed' },
    { path: 'peopleInvolved', value: draft.peopleInvolved, message: 'How many people touch each run is needed' },
  ]
  for (const figure of figures) {
    if (figure.value === null) issues.push({ path: figure.path, message: figure.message })
  }
  if (draft.revenueImpact === '') issues.push({ path: 'revenueImpact', message: 'Choose how close this process is to revenue' })
  return issues
}

export function processFromDraft(id: string, draft: NewProcessDraft): Process | null {
  const { occurrencesPerMonth, minutesPerOccurrence, peopleInvolved, revenueImpact } = draft
  if (occurrencesPerMonth === null || minutesPerOccurrence === null || peopleInvolved === null || revenueImpact === '') return null
  if (processDraftIssues(draft).length > 0) return null
  const owner = draft.owner.trim()
  return {
    id,
    name: draft.name,
    description: draft.description,
    // Absent is the empty value, so an owner nobody named is left out rather than stored blank.
    ...(owner === '' ? {} : { owner }),
    frequency: { occurrencesPerMonth, minutesPerOccurrence, peopleInvolved },
    roleHourlyCost: draft.roleHourlyCost,
    steps: [],
    systemsTouched: [],
    painPoints: [],
    errorProfile: { errorRatePercent: draft.errorRatePercent, costPerError: draft.costPerError },
    revenueImpact,
    customerFacing: draft.customerFacing,
  }
}

// Where each process-scoped mapping lands in the draft.
const FROM_PATH: Readonly<Record<string, ProcessFigureField>> = {
  'process.frequency.occurrencesPerMonth': 'occurrencesPerMonth',
  'process.frequency.minutesPerOccurrence': 'minutesPerOccurrence',
  'process.frequency.peopleInvolved': 'peopleInvolved',
  'process.roleHourlyCost': 'roleHourlyCost',
  'process.errorProfile.errorRatePercent': 'errorRatePercent',
  'process.errorProfile.costPerError': 'costPerError',
}

// Starts a process from what a session already recorded, so a figure the client gave is never asked for
// twice. Each one is carried whole, keeping the source, the note, the link back to its answer and when
// it was said. The name and the steps are still typed: no mappable path holds them, so the session's
// answers to those questions are prose this cannot read.
export function processDraftFromSession(session: DiscoverySession, set: QuestionSet): NewProcessDraft {
  const draft = { ...initialProcessDraft(), fromSessionId: session.id }
  const byQuestion = new Map(session.answers.map((answer) => [answer.questionId, answer]))
  for (const question of set.questions) {
    const answer = byQuestion.get(question.id)
    if (question.mapsTo === undefined || answer === undefined || !isAnswered(answer)) continue
    if (question.mapsTo === 'process.revenueImpact') {
      if (answer.value === 'direct' || answer.value === 'indirect' || answer.value === 'none') draft.revenueImpact = answer.value
      continue
    }
    const field = FROM_PATH[question.mapsTo]
    if (field !== undefined && answer.traced !== undefined) draft[field] = answer.traced
  }
  return draft
}

// ---- Steps and integrations -------------------------------------------------------------------------

// Manual by default, because a step worth writing down is usually one a person does; the flag is on
// screen either way, so nothing is claimed that was not said.
export function newStep(id: string): ProcessStep {
  return { id, action: '', isManual: true, isBottleneck: false }
}

export function newIntegration(): EffortInputs['integrations'][number] {
  return { name: '', hasPublicApi: false, authAvailable: false }
}

// ---- A new opportunity -------------------------------------------------------------------------------

export interface NewOpportunityDraft {
  title: string
  summary: string
  processIds: string[]
  automatablePercent: TracedValue | null
  errorReductionPercent: TracedValue | null
  // Empty until chosen: each is an assessment of the build, and none of the three has a neutral value.
  dataReadiness: EffortInputs['dataReadiness'] | ''
  volumeTier: EffortInputs['volumeTier'] | ''
  novelty: EffortInputs['novelty'] | ''
  // A real answer rather than a placeholder, and shown in the panel so it is never silent.
  approvalSteps: number
  requiresHumanInLoop: boolean
}

export function initialOpportunityDraft(): NewOpportunityDraft {
  return {
    title: '',
    summary: '',
    processIds: [],
    automatablePercent: null,
    errorReductionPercent: null,
    dataReadiness: '',
    volumeTier: '',
    novelty: '',
    approvalSteps: 0,
    requiresHumanInLoop: false,
  }
}

export function opportunityDraftIssues(draft: NewOpportunityDraft): FormIssue[] {
  const issues: FormIssue[] = []
  if (draft.title.trim() === '') issues.push({ path: 'title', message: 'An opportunity needs a title' })
  if (draft.processIds.length === 0) issues.push({ path: 'processIds', message: 'An opportunity is about at least one process' })
  if (draft.automatablePercent === null) issues.push({ path: 'automatablePercent', message: 'How much of the work can be automated is needed' })
  if (draft.errorReductionPercent === null) issues.push({ path: 'errorReductionPercent', message: 'How much of the error rate it removes is needed' })
  if (draft.dataReadiness === '') issues.push({ path: 'dataReadiness', message: 'Choose how ready the data is' })
  if (draft.volumeTier === '') issues.push({ path: 'volumeTier', message: 'Choose the volume tier' })
  if (draft.novelty === '') issues.push({ path: 'novelty', message: 'Choose how novel this build is' })
  return issues
}

export function opportunityFromDraft(id: string, draft: NewOpportunityDraft): Opportunity | null {
  const { automatablePercent, errorReductionPercent, dataReadiness, volumeTier, novelty } = draft
  if (automatablePercent === null || errorReductionPercent === null || dataReadiness === '' || volumeTier === '' || novelty === '') return null
  if (opportunityDraftIssues(draft).length > 0) return null
  return {
    id,
    processIds: [...draft.processIds],
    title: draft.title,
    summary: draft.summary,
    // Patterns are linked in the editor, and the Library seeds them in Stage 2, task 9.
    patternIds: [],
    primaryPatternId: null,
    automatablePercent,
    errorReductionPercent,
    effortInputs: {
      integrations: [],
      dataReadiness,
      approvalSteps: draft.approvalSteps,
      complianceFlags: [],
      volumeTier,
      novelty,
      requiresHumanInLoop: draft.requiresHumanInLoop,
    },
    // Nothing computes yet: the recompute on the next load fills this in.
    scoring: null,
  }
}

// ---- References and removal ---------------------------------------------------------------------------

// References the schema leaves to the engines, which raise MISSING_PROCESS and score no value for one.
// The editor refuses them, so none is ever written from the app.
export function referenceIssues(processes: readonly Process[], opportunities: readonly Opportunity[]): FormIssue[] {
  const ids = new Set(processes.map((process) => process.id))
  return opportunities.flatMap((opportunity, index) => {
    const path = `opportunities.${index}.processIds`
    if (opportunity.processIds.length === 0) return [{ path, message: 'An opportunity is about at least one process' }]
    return opportunity.processIds
      .filter((id) => !ids.has(id))
      .map((id) => ({ path, message: `No process in this engagement has the id '${id}'` }))
  })
}

export function processUsage(processId: string, opportunities: readonly Opportunity[]): Opportunity[] {
  return opportunities.filter((opportunity) => opportunity.processIds.includes(processId))
}

// Why a record cannot be removed yet, in the words the row shows, or null when it can.
export function processRemovalBlock(processId: string, opportunities: readonly Opportunity[]): string | null {
  const used = processUsage(processId, opportunities).length
  if (used === 0) return null
  return `${String(used)} ${used === 1 ? 'opportunity is' : 'opportunities are'} about this process`
}

// The scope's list is the only record of what is being priced, so removing a selected opportunity would
// price a different set from the one shown.
export function opportunityRemovalBlock(opportunityId: string, scope: ProjectScope | null): string | null {
  if (scope === null || !scope.selectedOpportunityIds.includes(opportunityId)) return null
  return 'This opportunity is in the scope being priced'
}
