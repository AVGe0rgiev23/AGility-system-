import type { Engagement } from '../schema/engagement'
import type { Library, Pattern } from '../schema/library'
import { SEED_PATTERN_IDS, seedPatterns } from '../schema/seed-patterns'

// Library-level edits to patterns, as pure functions. Each returns a new Library for the store to save
// whole. Mirrors question-set-library.ts.

export function missingSeedPatterns(library: Library): Pattern[] {
  const have = new Set(library.patterns.map((pattern) => pattern.id))
  return seedPatterns().filter((pattern) => SEED_PATTERN_IDS.includes(pattern.id) && !have.has(pattern.id))
}

// Adds only the seed patterns the Library does not have, so an edited seed pattern is never overwritten.
export function withSeedPatterns(library: Library): Library {
  return { ...library, patterns: [...library.patterns, ...missingSeedPatterns(library)] }
}

export function withPattern(library: Library, pattern: Pattern): Library {
  const index = library.patterns.findIndex((existing) => existing.id === pattern.id)
  const patterns = index < 0 ? [...library.patterns, pattern] : library.patterns.map((existing, at) => (at === index ? pattern : existing))
  return { ...library, patterns }
}

export function withoutPattern(library: Library, id: string): Library {
  return { ...library, patterns: library.patterns.filter((pattern) => pattern.id !== id) }
}

// Opportunities that link the pattern, across every engagement. primaryPatternId is always also in
// patternIds (OpportunitySchema), so checking patternIds alone counts both. Computed live from the
// engagements, the same way processUsage and opportunityRemovalBlock are (process-rules.ts): the
// pattern's own usedInEngagements field is not wired to anything yet (see the design questions in the
// implementation report), so it is not trustworthy for a delete guard.
export function patternUsage(engagements: readonly Engagement[], patternId: string): number {
  return engagements.reduce(
    (count, engagement) => count + engagement.opportunities.filter((opportunity) => opportunity.patternIds.includes(patternId)).length,
    0,
  )
}

// Starts with only a name and a base-hours estimate: baseHours feeds scoring's rawBuildHours, so
// nothing sensible defaults it, and creation is refused until one is typed (pattern-list-view.tsx).
// Every other field is the schema's blank value; PatternSchema requires no more than a name to save,
// exactly as a new process starts with a blank description. complexity has no neutral value in its
// enum, so it starts at 'low', which nothing reads: no engine looks at Pattern.complexity, only baseHours.
export function newPattern(id: string, name: string, baseHours: number): Pattern {
  return {
    id,
    name,
    category: '',
    problem: '',
    solution: '',
    architecture: '',
    requiredIntegrations: [],
    complexity: 'low',
    baseHours,
    risks: [],
    clientExplanation: '',
    blueprintSkeleton: null,
    codeNotes: '',
    usedInEngagements: [],
  }
}
