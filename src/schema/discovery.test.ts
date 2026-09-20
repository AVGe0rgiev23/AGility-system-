import { describe, expect, expectTypeOf, it } from 'vitest'
import { answer, discoverySession, issuePaths, question, questionSet, roundTrip, tracedHours } from './__fixtures__/records'
import {
  AnswerSchema,
  ConditionSchema,
  DiscoverySessionSchema,
  MAPPABLE_PATHS,
  MAPPING_TARGETS,
  MappablePathSchema,
  QuestionSchema,
  QuestionSetSchema,
  type Answer,
  type Condition,
  type MappablePath,
  type Question,
  type QuestionSet,
} from './discovery'
import type { TracedValue } from './traced'

describe('MAPPABLE_PATHS', () => {
  it('drives the Zod enum exactly', () => {
    expect(MappablePathSchema.options).toEqual([...MAPPABLE_PATHS])
    for (const path of MAPPABLE_PATHS) {
      expect(MappablePathSchema.safeParse(path).success).toBe(true)
    }
  })

  it('rejects a typo with a message naming the bad path', () => {
    const result = MappablePathSchema.safeParse('company.blendedHourlyCosts')
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe("'company.blendedHourlyCosts' is not a mappable path")
  })

  it('derives the type from the const array', () => {
    expectTypeOf<MappablePath>().toEqualTypeOf<(typeof MAPPABLE_PATHS)[number]>()
    expectTypeOf<'company.blendedHourlyCost'>().toExtend<MappablePath>()
    expectTypeOf<'company.name'>().not.toExtend<MappablePath>()
  })
})

describe('ConditionSchema', () => {
  it('accepts each leaf condition', () => {
    expect(issuePaths(ConditionSchema, { answerId: 'a', equals: 'yes' })).toEqual([])
    expect(issuePaths(ConditionSchema, { answerId: 'a', equals: false })).toEqual([])
    expect(issuePaths(ConditionSchema, { answerId: 'a', gt: 10 })).toEqual([])
    expect(issuePaths(ConditionSchema, { answerId: 'a', includes: 'HubSpot' })).toEqual([])
  })

  it('accepts nested all/any conditions', () => {
    const nested: Condition = {
      all: [
        { answerId: 'a', gt: 10 },
        { any: [{ answerId: 'b', equals: true }, { all: [{ answerId: 'c', includes: 'x' }] }] },
      ],
    }
    expect(ConditionSchema.parse(nested)).toEqual(nested)
  })

  it('rejects malformed conditions at any depth', () => {
    expect(ConditionSchema.safeParse({ answerId: 'a' }).success).toBe(false)
    expect(ConditionSchema.safeParse({ answerId: 'a', gt: '10' }).success).toBe(false)
    expect(ConditionSchema.safeParse({ all: [{ any: [{ answerId: 'a', gt: 'ten' }] }] }).success).toBe(false)
  })

  it('infers a recursive type rather than any', () => {
    expectTypeOf<Condition>().not.toBeAny()
    expectTypeOf<{ all: Condition[] }>().toExtend<Condition>()
    expectTypeOf<{ any: Condition[] }>().toExtend<Condition>()
    expectTypeOf<{ answerId: string; gt: string }>().not.toExtend<Condition>()
  })
})

describe('AnswerSchema', () => {
  it('accepts a traced numeric answer', () => {
    expect(AnswerSchema.parse(answer())).toEqual(answer())
  })

  it('accepts every documented value shape, each with the kind that takes it', () => {
    const plain = { ...answer(), traced: undefined }
    expect(issuePaths(AnswerSchema, { ...plain, kind: 'text', value: 'Sheets' })).toEqual([])
    expect(issuePaths(AnswerSchema, { ...plain, kind: 'choice', value: 'weekly' })).toEqual([])
    expect(issuePaths(AnswerSchema, { ...plain, kind: 'boolean', value: false })).toEqual([])
    expect(issuePaths(AnswerSchema, { ...plain, kind: 'multi', value: ['a', 'b'] })).toEqual([])
    expect(issuePaths(AnswerSchema, { ...answer(), kind: 'duration', value: 4 })).toEqual([])
    expect(issuePaths(AnswerSchema, { ...answer(), value: { hours: 4 } })).toEqual(['value'])
  })

  it('refuses a value that does not suit its kind', () => {
    const plain = { ...answer(), traced: undefined }
    expect(issuePaths(AnswerSchema, { ...plain, kind: 'text', value: 3 })).toEqual(['value'])
    expect(issuePaths(AnswerSchema, { ...plain, kind: 'choice', value: ['a'] })).toEqual(['value'])
    expect(issuePaths(AnswerSchema, { ...plain, kind: 'boolean', value: 'yes' })).toEqual(['value'])
    expect(issuePaths(AnswerSchema, { ...plain, kind: 'multi', value: 'a' })).toEqual(['value'])
    expect(issuePaths(AnswerSchema, { ...answer(), value: '4', traced: { ...tracedHours(), value: 4 } }).sort()).toEqual(['traced.value', 'value'])
  })

  it('refuses a blank or repeated item in a multi answer, at the item', () => {
    const plain = { ...answer(), traced: undefined, kind: 'multi' }
    expect(issuePaths(AnswerSchema, { ...plain, value: ['HubSpot', ' ', 'HubSpot'] })).toEqual(['value.1', 'value.2'])
  })

  it('requires a number or duration answer to be traced, with the same value, and nothing else to be', () => {
    expect(issuePaths(AnswerSchema, { ...answer(), traced: undefined })).toEqual(['traced'])
    expect(issuePaths(AnswerSchema, { ...answer(), value: 5 })).toEqual(['traced.value'])
    expect(issuePaths(AnswerSchema, { ...answer(), kind: 'text', value: 'four' })).toEqual(['traced'])
  })

  it('rejects an unknown flag', () => {
    expect(issuePaths(AnswerSchema, { ...answer(), flags: ['urgent'] })).toEqual(['flags.0'])
  })

  it('infers the spec types', () => {
    expectTypeOf<Answer['value']>().toEqualTypeOf<string | number | boolean | string[]>()
    expectTypeOf<Answer['traced']>().toEqualTypeOf<TracedValue | undefined>()
  })
})

describe('DiscoverySessionSchema', () => {
  it('accepts a valid session', () => {
    expect(DiscoverySessionSchema.parse(discoverySession())).toEqual(discoverySession())
  })

  it('bounds completeness to 0-100', () => {
    expect(issuePaths(DiscoverySessionSchema, { ...discoverySession(), completeness: 0 })).toEqual([])
    expect(issuePaths(DiscoverySessionSchema, { ...discoverySession(), completeness: 100 })).toEqual([])
    expect(issuePaths(DiscoverySessionSchema, { ...discoverySession(), completeness: 101 })).toEqual([
      'completeness',
    ])
    expect(issuePaths(DiscoverySessionSchema, { ...discoverySession(), completeness: -1 })).toEqual([
      'completeness',
    ])
  })

  it('survives a JSON round trip unchanged', () => {
    expect(DiscoverySessionSchema.parse(roundTrip(discoverySession()))).toEqual(discoverySession())
  })

  it('refuses a second answer to the same question, at the later one', () => {
    const session = discoverySession()
    const answers = [answer(), { ...answer(), id: 'ans-2' }]
    expect(issuePaths(DiscoverySessionSchema, { ...session, answers })).toEqual(['answers.1.questionId'])
  })
})

describe('QuestionSchema and QuestionSetSchema', () => {
  it('accept a valid question set', () => {
    expect(QuestionSetSchema.parse(questionSet())).toEqual(questionSet())
  })

  it('share their kind enums with Answer and DiscoverySession', () => {
    expect(QuestionSchema.shape.kind.options).toEqual(AnswerSchema.shape.kind.options)
    expect(QuestionSetSchema.shape.kind.options).toEqual(DiscoverySessionSchema.shape.kind.options)
  })

  it('refuse a question set whose mapsTo has a typo, pointing at the question', () => {
    const set = questionSet()
    const invalid = { ...set, questions: [question(), { ...question(), id: 'q-2', mapsTo: 'company.nmae' }] }
    const result = QuestionSetSchema.safeParse(invalid)
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([['questions', 1, 'mapsTo']])
    expect(result.error?.issues[0]?.message).toBe("'company.nmae' is not a mappable path")
  })

  it('refuse an invalid showIf condition', () => {
    const invalid = { ...questionSet(), questions: [{ ...question(), showIf: { answerId: 'a' } }] }
    expect(issuePaths(QuestionSetSchema, invalid)).toEqual(['questions.0.showIf'])
  })

  it('survive a JSON round trip unchanged', () => {
    expect(QuestionSetSchema.parse(roundTrip(questionSet()))).toEqual(questionSet())
  })

  it('leave a condition naming a question outside the set to fail safe, as every frozen fixture has one', () => {
    expect(questionSet().questions[0]?.showIf).toEqual({ answerId: 'q-has-staff', equals: true })
    expect(issuePaths(QuestionSetSchema, questionSet())).toEqual([])
  })

  it('infer the spec types', () => {
    expectTypeOf<Question['kind']>().toEqualTypeOf<Answer['kind']>()
    expectTypeOf<Question['mapsTo']>().toEqualTypeOf<MappablePath | undefined>()
    expectTypeOf<Question['showIf']>().toEqualTypeOf<Condition | undefined>()
    expectTypeOf<QuestionSet['appliesTo']>().toEqualTypeOf<{
      industries?: string[] | undefined
      minEmployees?: number | undefined
    }>()
  })
})

describe('QuestionSetSchema rules', () => {
  const text = (id: string, extra: Partial<Question> = {}): Question => ({ id, text: `Question ${id}`, kind: 'text', required: false, ...extra })
  const set = (...questions: Question[]): QuestionSet => ({ id: 'qs', name: 'Set', kind: 'teardown', appliesTo: {}, questions })
  const paths = (value: QuestionSet) => issuePaths(QuestionSetSchema, value)

  it('requires a set name, question text, and question ids unique in the set', () => {
    expect(paths({ ...set(text('a')), name: ' ' })).toEqual(['name'])
    expect(paths(set(text('a', { text: '' })))).toEqual(['questions.0.text'])
    expect(paths(set(text('a'), text('a')))).toEqual(['questions.1.id'])
  })

  it('requires a whole minimum employee count of at least 0', () => {
    expect(paths({ ...set(text('a')), appliesTo: { minEmployees: 2.5 } })).toEqual(['appliesTo.minEmployees'])
    expect(paths({ ...set(text('a')), appliesTo: { minEmployees: 0 } })).toEqual([])
  })

  it('requires choices on a choice or multi question, non-blank and distinct, and on no other kind', () => {
    expect(paths(set(text('a', { kind: 'choice' })))).toEqual(['questions.0.choices'])
    expect(paths(set(text('a', { kind: 'multi', choices: [] })))).toEqual(['questions.0.choices'])
    expect(paths(set(text('a', { kind: 'choice', choices: ['x', '', 'x'] })))).toEqual(['questions.0.choices.1', 'questions.0.choices.2'])
    expect(paths(set(text('a', { choices: ['x'] })))).toEqual(['questions.0.choices'])
  })

  it('maps a question only to a path its kind can fill', () => {
    expect(paths(set(text('a', { mapsTo: 'company.blendedHourlyCost' })))).toEqual(['questions.0.mapsTo'])
    expect(paths(set(text('a', { kind: 'multi', choices: ['HubSpot'], mapsTo: 'company.statedTools' })))).toEqual([])
    expect(paths(set(text('a', { mapsTo: 'company.statedTools' })))).toEqual(['questions.0.mapsTo'])
    expect(paths(set(text('a', { kind: 'duration', mapsTo: 'process.frequency.minutesPerOccurrence' })))).toEqual([])
    expect(paths(set(text('a', { kind: 'number', mapsTo: 'process.frequency.minutesPerOccurrence' })))).toEqual(['questions.0.mapsTo'])
    for (const path of MAPPABLE_PATHS) expect(MAPPING_TARGETS[path].kinds.length, path).toBeGreaterThan(0)
  })

  it('takes an enum path only with choices that path holds', () => {
    expect(paths(set(text('a', { kind: 'choice', choices: ['hybrid', 'client-owned'], mapsTo: 'company.preferredDeliveryModel' })))).toEqual([])
    expect(paths(set(text('a', { kind: 'choice', choices: ['hybrid', 'self-hosted'], mapsTo: 'company.preferredDeliveryModel' })))).toEqual(['questions.0.choices.1'])
    expect(paths(set(text('a', { kind: 'choice', choices: ['direct', 'huge'], mapsTo: 'process.revenueImpact' })))).toEqual(['questions.0.choices.1'])
  })

  it('gives a number exactly one source for its unit, and never a money unit of its own', () => {
    expect(paths(set(text('a', { kind: 'number', unit: 'orders/day' })))).toEqual([])
    expect(paths(set(text('a', { kind: 'number' })))).toEqual(['questions.0.unit'])
    expect(paths(set(text('a', { kind: 'number', unit: ' ' })))).toEqual(['questions.0.unit'])
    expect(paths(set(text('a', { kind: 'number', unit: 'EUR/hour' })))).toEqual(['questions.0.unit'])
    expect(paths(set(text('a', { kind: 'number', unit: 'EUR/hour', mapsTo: 'company.blendedHourlyCost' })))).toEqual(['questions.0.unit'])
    expect(paths(set(text('a', { kind: 'duration', unit: 'hours' })))).toEqual(['questions.0.unit'])
    expect(paths(set(text('a', { unit: 'words' })))).toEqual(['questions.0.unit'])
  })

  it('lets a condition test only an earlier question', () => {
    expect(paths(set(text('a'), text('b', { showIf: { answerId: 'a', includes: 'x' } })))).toEqual([])
    expect(paths(set(text('a', { showIf: { answerId: 'a', includes: 'x' } })))).toEqual(['questions.0.showIf.answerId'])
    expect(paths(set(text('a', { showIf: { answerId: 'b', includes: 'x' } }), text('b')))).toEqual(['questions.0.showIf.answerId'])
  })

  it('tests a question only in a way its kind allows, at any depth', () => {
    const yesNo = text('yn', { kind: 'boolean' })
    const count = text('n', { kind: 'number', unit: 'count' })
    const picks = text('m', { kind: 'multi', choices: ['x', 'y'] })
    const pick = text('c', { kind: 'choice', choices: ['weekly', 'daily'] })
    const later = (showIf: Condition) => text('z', { showIf })
    const check = (showIf: Condition) => paths(set(yesNo, count, picks, pick, later(showIf)))

    expect(check({ answerId: 'yn', equals: true })).toEqual([])
    expect(check({ answerId: 'n', gt: 10 })).toEqual([])
    expect(check({ answerId: 'm', includes: 'x' })).toEqual([])
    expect(check({ answerId: 'c', equals: 'daily' })).toEqual([])

    expect(check({ answerId: 'yn', gt: 1 })).toEqual(['questions.4.showIf.gt'])
    expect(check({ answerId: 'n', includes: '1' })).toEqual(['questions.4.showIf.includes'])
    expect(check({ answerId: 'yn', equals: 'yes' })).toEqual(['questions.4.showIf.equals'])
    expect(check({ answerId: 'm', equals: 'x' })).toEqual(['questions.4.showIf.equals'])
    expect(check({ answerId: 'c', equals: 'monthly' })).toEqual(['questions.4.showIf.equals'])
    expect(check({ all: [{ answerId: 'n', gt: 1 }, { any: [{ answerId: 'yn', gt: 1 }] }] })).toEqual(['questions.4.showIf.all.1.any.0.gt'])
  })
})
