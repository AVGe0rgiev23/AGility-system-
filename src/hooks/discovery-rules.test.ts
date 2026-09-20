import { describe, expect, it } from 'vitest'
import { mulberry32, pick, randomInt, type Random } from '../engines/__fixtures__/engine-fixtures'
import { company, newEngagement } from '../schema/__fixtures__/records'
import type { Answer, AnswerKind, Condition, DiscoverySession, Question, QuestionSet } from '../schema/discovery'
import { DISCOVERY_SET_ID, seedQuestionSets } from '../schema/seed-question-sets'
import type { TracedValue } from '../schema/traced'
import {
  applyAnswer,
  appliesToCompany,
  completeness,
  evaluateCondition,
  followUps,
  isAnswered,
  landsOnCompany,
  measureOf,
  questionStates,
  tracedForAnswer,
  unresolvedReferences,
  withDerived,
} from './discovery-rules'

const COST: TracedValue = { value: 21.5, unit: 'EUR/hour', currency: 'EUR', source: 'client-stated', note: 'Marta: about 21.50 all in' }

function answer(questionId: string, kind: AnswerKind, value: Answer['value'], traced?: TracedValue): Answer {
  return { id: `ans-${questionId}`, questionId, kind, value, ...(traced === undefined ? {} : { traced }), followUpTriggered: [], flags: [] }
}

function counted(value: number, unit = 'count'): TracedValue {
  return { value, unit, source: 'client-stated' }
}

function q(id: string, kind: AnswerKind, extra: Partial<Question> = {}): Question {
  return { id, text: id, kind, required: true, ...extra }
}

function set(...questions: Question[]): QuestionSet {
  return { id: 'qs', name: 'Set', kind: 'discovery', appliesTo: {}, questions }
}

function discovery(): QuestionSet {
  const found = seedQuestionSets().find((candidate) => candidate.id === DISCOVERY_SET_ID)
  if (found === undefined) throw new Error('no seed')
  return found
}

describe('isAnswered', () => {
  it('counts only a real answer of each kind', () => {
    expect(isAnswered(undefined)).toBe(false)
    expect(isAnswered(answer('a', 'text', '  '))).toBe(false)
    expect(isAnswered(answer('a', 'text', 'Sheets'))).toBe(true)
    expect(isAnswered(answer('a', 'choice', ''))).toBe(false)
    expect(isAnswered(answer('a', 'choice', 'weekly'))).toBe(true)
    expect(isAnswered(answer('a', 'number', 4))).toBe(false)
    expect(isAnswered(answer('a', 'number', 4, counted(4)))).toBe(true)
    expect(isAnswered(answer('a', 'duration', 0, counted(0, 'minutes')))).toBe(true)
    expect(isAnswered(answer('a', 'boolean', false))).toBe(true)
    expect(isAnswered(answer('a', 'multi', []))).toBe(false)
    expect(isAnswered(answer('a', 'multi', ['HubSpot']))).toBe(true)
  })
})

describe('evaluateCondition', () => {
  const answers = new Map([
    ['yn', answer('yn', 'boolean', true)],
    ['n', answer('n', 'number', 12, counted(12))],
    ['m', answer('m', 'multi', ['HubSpot', 'Xero'])],
    ['t', answer('t', 'text', 'We use HubSpot for leads')],
    ['c', answer('c', 'choice', 'weekly')],
    ['blank', answer('blank', 'text', ' ')],
  ])

  it('reads each leaf test', () => {
    expect(evaluateCondition({ answerId: 'yn', equals: true }, answers)).toBe(true)
    expect(evaluateCondition({ answerId: 'yn', equals: false }, answers)).toBe(false)
    expect(evaluateCondition({ answerId: 'n', gt: 10 }, answers)).toBe(true)
    expect(evaluateCondition({ answerId: 'n', gt: 12 }, answers)).toBe(false)
    expect(evaluateCondition({ answerId: 'm', includes: 'Xero' }, answers)).toBe(true)
    expect(evaluateCondition({ answerId: 'm', includes: 'xero' }, answers)).toBe(false)
    expect(evaluateCondition({ answerId: 't', includes: 'hubspot' }, answers)).toBe(true)
    expect(evaluateCondition({ answerId: 'c', equals: 'weekly' }, answers)).toBe(true)
  })

  it('reads false for an unanswered question and for a question it cannot see, failing safe', () => {
    expect(evaluateCondition({ answerId: 'blank', includes: '' }, answers)).toBe(false)
    expect(evaluateCondition({ answerId: 'q-has-staff', equals: true }, answers)).toBe(false)
    expect(evaluateCondition({ answerId: 'yn', equals: false }, new Map())).toBe(false)
  })

  it('combines with all and any, at any depth', () => {
    const nested: Condition = { all: [{ answerId: 'yn', equals: true }, { any: [{ answerId: 'n', gt: 100 }, { answerId: 'c', equals: 'weekly' }] }] }
    expect(evaluateCondition(nested, answers)).toBe(true)
    expect(evaluateCondition({ all: [] }, answers)).toBe(true)
    expect(evaluateCondition({ any: [] }, answers)).toBe(false)
  })
})

describe('questionStates and completeness', () => {
  const branching = set(
    q('staff', 'boolean'),
    q('count', 'number', { unit: 'people', showIf: { answerId: 'staff', equals: true } }),
    q('big', 'text', { showIf: { answerId: 'count', gt: 10 } }),
    q('notes', 'text', { required: false }),
  )

  it('shows a question only when its condition reads true on earlier visible answers', () => {
    const none = questionStates(branching, [])
    expect(none.map((state) => state.visible)).toEqual([true, false, false, true])
    const yes = questionStates(branching, [answer('staff', 'boolean', true), answer('count', 'number', 40, counted(40))])
    expect(yes.map((state) => state.visible)).toEqual([true, true, true, true])
  })

  it('keeps an answer to a hidden question, but lets it satisfy no later condition', () => {
    const states = questionStates(branching, [answer('staff', 'boolean', false), answer('count', 'number', 40, counted(40))])
    expect(states.map((state) => state.visible)).toEqual([true, false, false, true])
    expect(states[1]?.answer?.value).toBe(40)
  })

  it('counts answered required questions that show, and is complete with none showing', () => {
    expect(completeness(questionStates(branching, []))).toEqual({ answered: 0, required: 1, percent: 0 })
    expect(completeness(questionStates(branching, [answer('staff', 'boolean', true)]))).toEqual({ answered: 1, required: 2, percent: 50 })
    const three = questionStates(branching, [answer('staff', 'boolean', true), answer('count', 'number', 40, counted(40))])
    expect(completeness(three)).toEqual({ answered: 2, required: 3, percent: 67 })
    expect(completeness(questionStates(set(q('notes', 'text', { required: false })), []))).toEqual({ answered: 0, required: 0, percent: 100 })
  })

  it('never counts an answer to a hidden question, for any set and any answers', () => {
    const random = mulberry32(0xd15c)
    for (let trial = 0; trial < 300; trial++) {
      const { questionSet, answers } = randomSession(random)
      const states = questionStates(questionSet, answers)
      const result = completeness(states)
      expect(result.required).toBe(states.filter((state) => state.visible && state.question.required).length)
      expect(result.answered).toBeLessThanOrEqual(result.required)
      expect(result.percent).toBeGreaterThanOrEqual(0)
      expect(result.percent).toBeLessThanOrEqual(100)

      // Answering a hidden question changes nothing that is counted or shown.
      const hidden = states.find((state) => !state.visible && state.answer === undefined)
      if (hidden !== undefined) {
        const more = [...answers, answer(hidden.question.id, 'boolean', true)]
        const after = questionStates(questionSet, more)
        expect(completeness(after)).toEqual(result)
        expect(after.map((state) => state.visible)).toEqual(states.map((state) => state.visible))
      }
    }
  })
})

describe('followUps and withDerived', () => {
  it('records which questions an answer unlocked, and stores completeness', () => {
    const questionSet = discovery()
    const session: DiscoverySession = {
      id: 'ds',
      kind: 'discovery',
      questionSetId: questionSet.id,
      heldAt: '2026-09-17T09:00:00.000Z',
      attendees: [],
      answers: [answer('fd-errors', 'boolean', true), answer('fd-regulated', 'boolean', false), answer('gone', 'text', 'kept', undefined)],
      rawNotes: '',
      completeness: 0,
    }
    const derived = withDerived({ ...session, answers: session.answers.map((item) => (item.questionId === 'gone' ? { ...item, followUpTriggered: ['x'] } : item)) }, questionSet)
    expect(derived.answers[0]?.followUpTriggered).toEqual(['fd-error-rate', 'fd-error-cost', 'fd-error-example'])
    expect(derived.answers[1]?.followUpTriggered).toEqual([])
    expect(derived.answers[2]?.followUpTriggered).toEqual(['x'])
    const states = questionStates(questionSet, derived.answers)
    expect(derived.completeness).toBe(completeness(states).percent)
    expect(followUps(states, 'fd-api')).toEqual([])
  })

  it('reveals a combined branch only when both of its answers match', () => {
    const questionSet = discovery()
    const visible = (answers: Answer[]) => questionStates(questionSet, answers).find((state) => state.question.id === 'fd-judgement-what')?.visible
    expect(visible([answer('fd-judgement', 'boolean', true)])).toBe(false)
    expect(visible([answer('fd-judgement', 'boolean', true), answer('fd-data-shape', 'choice', 'free text or scans')])).toBe(true)
  })
})

describe('measureOf and tracedForAnswer', () => {
  it('takes a mapped question’s measure from its path, a duration in minutes, and an unmapped number’s own unit', () => {
    expect(measureOf(q('a', 'number', { mapsTo: 'company.blendedHourlyCost' }))).toEqual({ money: true, per: 'hour' })
    expect(measureOf(q('a', 'number', { mapsTo: 'process.frequency.occurrencesPerMonth' }))).toEqual({ unit: 'count/month' })
    expect(measureOf(q('a', 'duration'))).toEqual({ unit: 'minutes' })
    expect(measureOf(q('a', 'number', { unit: 'orders/day' }))).toEqual({ unit: 'orders/day' })
    expect(measureOf(q('a', 'number'))).toBeNull()
    expect(measureOf(q('a', 'text'))).toBeNull()
  })

  it('links a figure to its answer, said when the session was held unless recorded otherwise', () => {
    expect(tracedForAnswer(COST, 'ans-1', '2026-09-17T09:00:00.000Z')).toEqual({ ...COST, answerId: 'ans-1', capturedAt: '2026-09-17T09:00:00.000Z' })
    expect(tracedForAnswer({ ...COST, capturedAt: '2026-09-01T00:00:00.000Z' }, 'ans-1', 'later').capturedAt).toBe('2026-09-01T00:00:00.000Z')
  })
})

describe('applyAnswer', () => {
  const base = company()

  it('lands a blended hourly cost whole, with its source and note intact and linked to its answer', () => {
    const traced = tracedForAnswer(COST, 'ans-cost', '2026-09-17T09:00:00.000Z')
    const next = applyAnswer(base, q('cost', 'number', { mapsTo: 'company.blendedHourlyCost' }), { ...answer('cost', 'number', 21.5, traced), id: 'ans-cost' })
    expect(next.blendedHourlyCost).toEqual({ value: 21.5, unit: 'EUR/hour', currency: 'EUR', source: 'client-stated', note: 'Marta: about 21.50 all in', answerId: 'ans-cost', capturedAt: '2026-09-17T09:00:00.000Z' })
    expect({ ...next, blendedHourlyCost: base.blendedHourlyCost }).toEqual(base)
  })

  it('lands a number, text and a delivery model by replacing', () => {
    expect(applyAnswer(base, q('n', 'number', { mapsTo: 'company.employeeCount' }), answer('n', 'number', 55, counted(55))).employeeCount).toBe(55)
    expect(applyAnswer(base, q('i', 'choice', { mapsTo: 'company.industry' }), answer('i', 'choice', 'E-commerce')).industry).toBe('E-commerce')
    expect(applyAnswer(base, q('s', 'text', { mapsTo: 'company.sourceOfTruth' }), answer('s', 'text', 'Airtable')).sourceOfTruth).toBe('Airtable')
    expect(applyAnswer(base, q('d', 'choice', { mapsTo: 'company.preferredDeliveryModel' }), answer('d', 'choice', 'client-owned')).preferredDeliveryModel).toBe('client-owned')
  })

  it('adds only the list items not already there, and never removes one', () => {
    const tools = applyAnswer(base, q('t', 'multi', { mapsTo: 'company.statedTools' }), answer('t', 'multi', ['HubSpot', 'Xero']))
    expect(tools.statedTools).toEqual(['Google Sheets', 'HubSpot', 'Xero'])
    const compliance = applyAnswer(base, q('c', 'multi', { mapsTo: 'company.constraints.compliance' }), answer('c', 'multi', ['SOC 2']))
    expect(compliance.constraints.compliance).toEqual(['GDPR', 'SOC 2'])
  })

  it('leaves the company exactly as it was for an unanswered, unmapped, process-mapped or mismatched answer', () => {
    expect(applyAnswer(base, q('i', 'text', { mapsTo: 'company.industry' }), answer('i', 'text', ' '))).toBe(base)
    expect(applyAnswer(base, q('i', 'text'), answer('i', 'text', 'Retail'))).toBe(base)
    expect(applyAnswer(base, q('p', 'number', { mapsTo: 'process.frequency.peopleInvolved' }), answer('p', 'number', 3, counted(3)))).toBe(base)
    expect(applyAnswer(base, q('n', 'number', { mapsTo: 'company.employeeCount' }), answer('n', 'text', 'forty'))).toBe(base)
    expect(applyAnswer(base, q('d', 'choice', { mapsTo: 'company.preferredDeliveryModel' }), answer('d', 'choice', 'self-hosted'))).toBe(base)
  })

  it('says where an answer lands in this slice', () => {
    expect(landsOnCompany(q('a', 'number', { mapsTo: 'company.employeeCount' }))).toBe(true)
    expect(landsOnCompany(q('a', 'number', { mapsTo: 'process.roleHourlyCost' }))).toBe(false)
    expect(landsOnCompany(q('a', 'text'))).toBe(false)
  })
})

describe('appliesToCompany and unresolvedReferences', () => {
  it('matches a set to a company by industry and minimum employees, and an open set to every company', () => {
    const bakery = newEngagement().company
    expect(appliesToCompany(set(), bakery)).toBe(true)
    expect(appliesToCompany({ ...set(), appliesTo: { industries: ['E-commerce'] } }, bakery)).toBe(true)
    expect(appliesToCompany({ ...set(), appliesTo: { industries: ['logistics'] } }, bakery)).toBe(false)
    expect(appliesToCompany({ ...set(), appliesTo: { minEmployees: 5 } }, bakery)).toBe(false)
    expect(appliesToCompany({ ...set(), appliesTo: { minEmployees: 5 } }, company())).toBe(true)
  })

  it('lists every condition naming a question the set does not have, at its path', () => {
    const questionSet = set(q('a', 'boolean'), q('b', 'text', { showIf: { any: [{ answerId: 'a', equals: true }, { all: [{ answerId: 'gone', equals: true }] }] } }))
    expect(unresolvedReferences(questionSet)).toEqual([{ path: 'questions.1.showIf.any.1.all.0.answerId', message: "No question in this set has the id 'gone'" }])
    expect(unresolvedReferences(discovery())).toEqual([])
  })
})

// ---- Random sessions ------------------------------------------------------------------------------

function randomCondition(random: Random, earlier: readonly Question[], depth = 0): Condition {
  const target = pick(random, earlier)
  if (depth < 2 && random() < 0.2) {
    const children = Array.from({ length: randomInt(random, 1, 3) }, () => randomCondition(random, earlier, depth + 1))
    return random() < 0.5 ? { all: children } : { any: children }
  }
  if (target.kind === 'boolean') return { answerId: target.id, equals: random() < 0.5 }
  if (target.kind === 'number') return { answerId: target.id, gt: randomInt(random, 0, 10) }
  return { answerId: target.id, equals: pick(random, target.choices ?? ['x']) }
}

function randomSession(random: Random): { questionSet: QuestionSet; answers: Answer[] } {
  const questions: Question[] = []
  const count = randomInt(random, 1, 12)
  for (let index = 0; index < count; index++) {
    const kind = pick(random, ['boolean', 'number', 'choice'] as const)
    const question: Question = {
      id: `q${index}`,
      text: `Question ${index}`,
      kind,
      required: random() < 0.7,
      ...(kind === 'choice' ? { choices: ['x', 'y'] } : {}),
      ...(kind === 'number' ? { unit: 'count' } : {}),
      ...(index > 0 && random() < 0.5 ? { showIf: randomCondition(random, questions) } : {}),
    }
    questions.push(question)
  }
  const answers = questions.flatMap((question): Answer[] => {
    if (random() < 0.4) return []
    if (question.kind === 'boolean') return [answer(question.id, 'boolean', random() < 0.5)]
    if (question.kind === 'number') {
      const value = randomInt(random, 0, 12)
      return [answer(question.id, 'number', value, counted(value))]
    }
    return [answer(question.id, 'choice', pick(random, ['x', 'y']))]
  })
  return { questionSet: set(...questions), answers }
}
