import { describe, expect, it } from 'vitest'
import { issuePaths, library } from './__fixtures__/records'
import { MAPPABLE_PATHS, QuestionSetSchema, type Condition, type QuestionSet } from './discovery'
import { LibrarySchema } from './library'
import { DISCOVERY_SET_ID, SEED_QUESTION_SET_IDS, seedQuestionSets, TEARDOWN_SET_ID } from './seed-question-sets'

function byId(id: string): QuestionSet {
  const found = seedQuestionSets().find((set) => set.id === id)
  if (found === undefined) throw new Error(`no seed set ${id}`)
  return found
}

function referencedIds(condition: Condition): string[] {
  if ('all' in condition) return condition.all.flatMap(referencedIds)
  if ('any' in condition) return condition.any.flatMap(referencedIds)
  return [condition.answerId]
}

function depth(condition: Condition): number {
  if ('all' in condition) return 1 + Math.max(0, ...condition.all.map(depth))
  if ('any' in condition) return 1 + Math.max(0, ...condition.any.map(depth))
  return 0
}

describe('seedQuestionSets', () => {
  it('seeds the teardown and full discovery sets under their stable ids', () => {
    expect(seedQuestionSets().map((set) => set.id)).toEqual([...SEED_QUESTION_SET_IDS])
    expect(byId(TEARDOWN_SET_ID)).toMatchObject({ name: 'Teardown', kind: 'teardown' })
    expect(byId(DISCOVERY_SET_ID)).toMatchObject({ name: 'Full discovery', kind: 'discovery' })
  })

  it('validates each set, and both together in a Library', () => {
    for (const set of seedQuestionSets()) expect(issuePaths(QuestionSetSchema, set), set.id).toEqual([])
    expect(issuePaths(LibrarySchema, { ...library(), questionSets: seedQuestionSets() })).toEqual([])
  })

  it('asks roughly 12 questions in a teardown and roughly 35 in a full discovery', () => {
    expect(byId(TEARDOWN_SET_ID).questions.length).toBeGreaterThanOrEqual(10)
    expect(byId(TEARDOWN_SET_ID).questions.length).toBeLessThanOrEqual(14)
    expect(byId(DISCOVERY_SET_ID).questions.length).toBeGreaterThanOrEqual(30)
    expect(byId(DISCOVERY_SET_ID).questions.length).toBeLessThanOrEqual(40)
  })

  it('branches the full discovery, including a condition that combines answers', () => {
    const conditions = byId(DISCOVERY_SET_ID).questions.flatMap((question) => (question.showIf === undefined ? [] : [question.showIf]))
    expect(conditions.length).toBeGreaterThanOrEqual(8)
    expect(conditions.some((condition) => depth(condition) > 0)).toBe(true)
  })

  it('makes every condition name an earlier question in the same set', () => {
    for (const set of seedQuestionSets()) {
      set.questions.forEach((question, index) => {
        if (question.showIf === undefined) return
        const earlier = new Set(set.questions.slice(0, index).map((candidate) => candidate.id))
        for (const id of referencedIds(question.showIf)) expect(earlier.has(id), `${set.id} ${question.id} -> ${id}`).toBe(true)
      })
    }
  })

  it('uses every mappable path at least once', () => {
    const used = new Set(seedQuestionSets().flatMap((set) => set.questions.flatMap((question) => (question.mapsTo === undefined ? [] : [question.mapsTo]))))
    for (const path of MAPPABLE_PATHS) expect(used.has(path), path).toBe(true)
  })

  it('returns fresh objects on every call', () => {
    const first = seedQuestionSets()
    first[0]?.questions.pop()
    expect(seedQuestionSets()[0]?.questions.length).toBe(byId(TEARDOWN_SET_ID).questions.length)
    expect(first[0]?.questions.length).toBe(byId(TEARDOWN_SET_ID).questions.length - 1)
  })
})
