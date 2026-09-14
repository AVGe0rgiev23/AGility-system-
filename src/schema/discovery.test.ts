import { describe, expect, expectTypeOf, it } from 'vitest'
import { answer, discoverySession, issuePaths, question, questionSet, roundTrip } from './__fixtures__/records'
import {
  AnswerSchema,
  ConditionSchema,
  DiscoverySessionSchema,
  MAPPABLE_PATHS,
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

  it('accepts every documented value shape', () => {
    for (const value of ['text', 3, true, ['a', 'b']]) {
      expect(issuePaths(AnswerSchema, { ...answer(), value })).toEqual([])
    }
    expect(issuePaths(AnswerSchema, { ...answer(), value: { hours: 4 } })).toEqual(['value'])
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
