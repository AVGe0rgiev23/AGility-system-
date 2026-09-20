import { describe, expect, it } from 'vitest'
import { engagement, library, newEngagement, questionSet } from '../schema/__fixtures__/records'
import { DISCOVERY_SET_ID, SEED_QUESTION_SET_IDS, seedQuestionSets, TEARDOWN_SET_ID } from '../schema/seed-question-sets'
import { missingSeedQuestionSets, newQuestionSet, sessionsUsing, withoutQuestionSet, withQuestionSet, withSeedQuestionSets } from './question-set-library'

describe('seed question sets in an existing Library', () => {
  it('adds only the seed sets a Library is missing, never overwriting an edited one', () => {
    const edited = { ...seedQuestionSets()[0], name: 'Teardown, shortened' } as ReturnType<typeof seedQuestionSets>[number]
    const partial = { ...library(), questionSets: [questionSet(), edited] }
    expect(missingSeedQuestionSets(partial).map((set) => set.id)).toEqual([DISCOVERY_SET_ID])
    const next = withSeedQuestionSets(partial)
    expect(next.questionSets.map((set) => set.id)).toEqual(['qs-discovery', TEARDOWN_SET_ID, DISCOVERY_SET_ID])
    expect(next.questionSets[1]?.name).toBe('Teardown, shortened')
    expect(missingSeedQuestionSets(next)).toEqual([])
    expect(withSeedQuestionSets({ ...library(), questionSets: [] }).questionSets.map((set) => set.id)).toEqual([...SEED_QUESTION_SET_IDS])
  })
})

describe('question set edits', () => {
  it('replaces a set by id, adds a new one at the end, and removes one', () => {
    const renamed = { ...questionSet(), name: 'Renamed' }
    expect(withQuestionSet(library(), renamed).questionSets).toEqual([renamed])
    const added = newQuestionSet('qs-new', 'Follow-up call', 'follow-up')
    expect(added).toEqual({ id: 'qs-new', name: 'Follow-up call', kind: 'follow-up', appliesTo: {}, questions: [] })
    expect(withQuestionSet(library(), added).questionSets.map((set) => set.id)).toEqual(['qs-discovery', 'qs-new'])
    expect(withoutQuestionSet(library(), 'qs-discovery').questionSets).toEqual([])
  })

  it('counts the sessions that use a set, across engagements', () => {
    expect(sessionsUsing([engagement(), newEngagement(), engagement()], 'qs-discovery')).toBe(2)
    expect(sessionsUsing([engagement()], TEARDOWN_SET_ID)).toBe(0)
  })
})
