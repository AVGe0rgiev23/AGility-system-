import { DeliveryModelSchema, type Company } from '../schema/company'
import { DURATION_UNIT, MAPPING_TARGETS, type Answer, type Condition, type DiscoverySession, type Measure, type Question, type QuestionSet } from '../schema/discovery'
import type { TracedValue } from '../schema/traced'
import type { FormIssue } from './form-paths'

// The rules of a discovery session, as pure functions: which questions show, what counts as answered,
// how complete a session is, and how an answer lands on the engagement.

export function isAnswered(answer: Answer | undefined): boolean {
  if (answer === undefined) return false
  const { kind, value } = answer
  switch (kind) {
    case 'text':
      return typeof value === 'string' && value.trim() !== ''
    case 'choice':
      return typeof value === 'string' && value !== ''
    case 'number':
    case 'duration':
      return typeof value === 'number' && answer.traced !== undefined
    case 'boolean':
      return typeof value === 'boolean'
    case 'multi':
      return Array.isArray(value) && value.length > 0
  }
}

// `answers` holds only answers that may be seen: those to visible questions earlier in the set. A
// condition on anything else, including a question not in the set, reads false.
export function evaluateCondition(condition: Condition, answers: ReadonlyMap<string, Answer>): boolean {
  if ('all' in condition) return condition.all.every((child) => evaluateCondition(child, answers))
  if ('any' in condition) return condition.any.some((child) => evaluateCondition(child, answers))
  const answer = answers.get(condition.answerId)
  if (answer === undefined || !isAnswered(answer)) return false
  const { value } = answer
  if ('equals' in condition) return value === condition.equals
  if ('gt' in condition) return typeof value === 'number' && value > condition.gt
  if (Array.isArray(value)) return value.includes(condition.includes)
  return typeof value === 'string' && value.toLocaleLowerCase('en-GB').includes(condition.includes.toLocaleLowerCase('en-GB'))
}

export interface QuestionState {
  question: Question
  index: number
  visible: boolean
  answer: Answer | undefined
}

// Questions are shown in order, so a condition sees only what has been asked and shown before it. An
// answer to a hidden question is kept, but it satisfies no condition.
export function questionStates(set: QuestionSet, answers: readonly Answer[]): QuestionState[] {
  const byQuestion = new Map(answers.map((answer) => [answer.questionId, answer]))
  const seen = new Map<string, Answer>()
  return set.questions.map((question, index) => {
    const answer = byQuestion.get(question.id)
    const visible = question.showIf === undefined || evaluateCondition(question.showIf, seen)
    if (visible && answer !== undefined && isAnswered(answer)) seen.set(question.id, answer)
    return { question, index, visible, answer }
  })
}

export interface Completeness {
  answered: number
  required: number
  // 0-100. A session with no required question showing is complete.
  percent: number
}

export function completeness(states: readonly QuestionState[]): Completeness {
  const required = states.filter((state) => state.visible && state.question.required)
  const answered = required.filter((state) => isAnswered(state.answer)).length
  return { answered, required: required.length, percent: required.length === 0 ? 100 : Math.round((100 * answered) / required.length) }
}

function references(condition: Condition): string[] {
  if ('all' in condition) return condition.all.flatMap(references)
  if ('any' in condition) return condition.any.flatMap(references)
  return [condition.answerId]
}

// The questions an answer has unlocked: showing now, and conditional on the answered question.
export function followUps(states: readonly QuestionState[], questionId: string): string[] {
  return states
    .filter((state) => state.visible && state.question.showIf !== undefined && references(state.question.showIf).includes(questionId))
    .map((state) => state.question.id)
}

// Completeness and each answer's follow-ups are stored on the session, so they are recomputed whenever
// an answer changes. An answer to a question the set no longer has keeps what it had.
export function withDerived(session: DiscoverySession, set: QuestionSet): DiscoverySession {
  const states = questionStates(set, session.answers)
  const known = new Set(set.questions.map((question) => question.id))
  return {
    ...session,
    completeness: completeness(states).percent,
    answers: session.answers.map((answer) => (known.has(answer.questionId) ? { ...answer, followUpTriggered: followUps(states, answer.questionId) } : answer)),
  }
}

// A session starts empty: its kind comes from the set it runs, and its completeness from the questions
// that show before anything is answered.
export function newSession(id: string, set: QuestionSet, heldAt: string, attendees: readonly string[]): DiscoverySession {
  const session: DiscoverySession = { id, kind: set.kind, questionSetId: set.id, heldAt, attendees: [...attendees], answers: [], rawNotes: '', completeness: 0 }
  return withDerived(session, set)
}

// What a figure answering this question is recorded in, or null for a question that records no figure
// (or an unmapped number question with no unit, which the schema refuses).
export function measureOf(question: Question): Measure | null {
  const target = question.mapsTo === undefined ? undefined : MAPPING_TARGETS[question.mapsTo]
  if (target?.measure !== undefined) return target.measure
  if (question.kind === 'duration') return { unit: DURATION_UNIT }
  if (question.kind === 'number' && question.unit !== undefined && question.unit.trim() !== '') return { unit: question.unit }
  return null
}

// A figure given in a session links back to its answer, and was said when the session was held unless
// it records otherwise.
export function tracedForAnswer(traced: TracedValue, answerId: string, heldAt: string): TracedValue {
  return { ...traced, answerId, capturedAt: traced.capturedAt ?? heldAt }
}

// Where a mapped answer lands as it is given. A process figure does not land live: it is carried over when a
// process is started from the session (process-rules.ts), since nothing yet says which process a session is about.
export function landsOnCompany(question: Question): boolean {
  return question.mapsTo !== undefined && question.mapsTo.startsWith('company.')
}

function addMissing(existing: readonly string[], added: readonly string[]): string[] {
  const result = [...existing]
  // A repeat within the answer is still a repeat on the path, and the company schema refuses one.
  for (const item of added) if (!result.includes(item)) result.push(item)
  return result
}

// Lands a given answer on the company, live. An unanswered answer, one to an unmapped or process-mapped
// question, or one whose value does not suit its path leaves the company exactly as it was. A list
// answer adds what is missing and never removes.
export function applyAnswer(company: Company, question: Question, answer: Answer): Company {
  if (question.mapsTo === undefined || !isAnswered(answer)) return company
  const { value } = answer
  switch (question.mapsTo) {
    case 'company.blendedHourlyCost':
      return answer.traced === undefined ? company : { ...company, blendedHourlyCost: answer.traced }
    case 'company.employeeCount':
      return typeof value === 'number' ? { ...company, employeeCount: value } : company
    case 'company.industry':
      return typeof value === 'string' ? { ...company, industry: value } : company
    case 'company.sourceOfTruth':
      return typeof value === 'string' ? { ...company, sourceOfTruth: value } : company
    case 'company.statedTools':
      return Array.isArray(value) ? { ...company, statedTools: addMissing(company.statedTools, value) } : company
    case 'company.constraints.compliance':
      return Array.isArray(value) ? { ...company, constraints: { ...company.constraints, compliance: addMissing(company.constraints.compliance, value) } } : company
    case 'company.preferredDeliveryModel': {
      const model = DeliveryModelSchema.safeParse(value)
      return model.success ? { ...company, preferredDeliveryModel: model.data } : company
    }
    default:
      return company
  }
}

// Whether a set is meant for this company, to list it first when a session is started.
export function appliesToCompany(set: QuestionSet, company: Company): boolean {
  const { industries, minEmployees } = set.appliesTo
  if (industries !== undefined && industries.length > 0 && !industries.includes(company.industry)) return false
  if (minEmployees !== undefined && (company.employeeCount === undefined || company.employeeCount < minEmployees)) return false
  return true
}

// References the schema leaves to fail safe: a condition naming a question the set does not have.
// The editor refuses them, so none is ever written from the app.
export function unresolvedReferences(set: QuestionSet): FormIssue[] {
  const ids = new Set(set.questions.map((question) => question.id))
  const walk = (condition: Condition, path: string): FormIssue[] => {
    if ('all' in condition) return condition.all.flatMap((child, index) => walk(child, `${path}.all.${index}`))
    if ('any' in condition) return condition.any.flatMap((child, index) => walk(child, `${path}.any.${index}`))
    return ids.has(condition.answerId) ? [] : [{ path: `${path}.answerId`, message: `No question in this set has the id '${condition.answerId}'` }]
  }
  return set.questions.flatMap((question, index) => (question.showIf === undefined ? [] : walk(question.showIf, `questions.${index}.showIf`)))
}
