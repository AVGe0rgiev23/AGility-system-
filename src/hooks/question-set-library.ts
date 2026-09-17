import type { QuestionSet } from '../schema/discovery'
import type { Engagement } from '../schema/engagement'
import type { Library } from '../schema/library'
import { SEED_QUESTION_SET_IDS, seedQuestionSets } from '../schema/seed-question-sets'

// Library-level edits to question sets, as pure functions. Each returns a new Library for the store to
// save whole.

export function missingSeedQuestionSets(library: Library): QuestionSet[] {
  const have = new Set(library.questionSets.map((set) => set.id))
  return seedQuestionSets().filter((set) => SEED_QUESTION_SET_IDS.includes(set.id) && !have.has(set.id))
}

// Adds only the seed sets the Library does not have, so an edited seed set is never overwritten.
export function withSeedQuestionSets(library: Library): Library {
  return { ...library, questionSets: [...library.questionSets, ...missingSeedQuestionSets(library)] }
}

export function withQuestionSet(library: Library, set: QuestionSet): Library {
  const index = library.questionSets.findIndex((existing) => existing.id === set.id)
  const questionSets = index < 0 ? [...library.questionSets, set] : library.questionSets.map((existing, at) => (at === index ? set : existing))
  return { ...library, questionSets }
}

export function withoutQuestionSet(library: Library, id: string): Library {
  return { ...library, questionSets: library.questionSets.filter((set) => set.id !== id) }
}

// Sessions that name a set. A set that sessions use is not deleted: their answers would lose their questions.
export function sessionsUsing(engagements: readonly Engagement[], setId: string): number {
  return engagements.reduce((count, engagement) => count + engagement.discovery.filter((session) => session.questionSetId === setId).length, 0)
}

export function newQuestionSet(id: string, name: string, kind: QuestionSet['kind']): QuestionSet {
  return { id, name, kind, appliesTo: {}, questions: [] }
}
