import { describe, expect, it } from 'vitest'
import * as signalRules from '../engines/signal-rules'
import { engagement, library, newEngagement, opportunity, pattern } from '../schema/__fixtures__/records'
import type { Engagement } from '../schema/engagement'
import type { Library, Pattern } from '../schema/library'
import { SEED_PATTERN_IDS, seedPatterns } from '../schema/seed-patterns'
import { missingSeedPatterns, newPattern, patternUsage, withoutPattern, withPattern, withSeedPatterns } from './pattern-library'

describe('SEED_PATTERN_IDS covers every id signal-rules.ts names as a candidate pattern', () => {
  it('pins every pain-rule pattern id to a real seed id, so a typo on either side fails here rather than leaving a pain hint unresolved', () => {
    // A subset, not an equality: nothing requires every seed pattern to be a pain-rule candidate
    // (webhook processing is not, since no pain phrase implies it), but a pain rule naming a
    // pattern id that is not seeded would be a hint pointing at nothing.
    const namedBySignalRules = new Set(signalRules.PAIN_RULES.flatMap((rule) => rule.patternIds))
    const seeded = new Set(SEED_PATTERN_IDS)
    for (const id of namedBySignalRules) expect(seeded.has(id), id).toBe(true)
  })
})

describe('missingSeedPatterns and withSeedPatterns', () => {
  it('names every seed pattern missing from an empty library', () => {
    const empty: Library = { patterns: [], questionSets: [], templates: [], calibration: [] }
    expect(missingSeedPatterns(empty).map((pattern) => pattern.id)).toEqual([...SEED_PATTERN_IDS])
  })

  it('names nothing missing once every seed id is present, even if the pattern was edited', () => {
    const edited: Library = { ...library(), patterns: seedPatterns().map((seed) => ({ ...seed, baseHours: seed.baseHours + 1 })) }
    expect(missingSeedPatterns(edited)).toEqual([])
  })

  it('adds only the missing seed patterns, never overwriting one already there', () => {
    const record = seedPatterns()[0]
    if (record === undefined) throw new Error('no seed pattern')
    const edited = { ...record, name: 'Renamed by Alex' }
    const partial: Library = { ...library(), patterns: [edited] }
    const result = withSeedPatterns(partial)
    expect(result.patterns).toHaveLength(SEED_PATTERN_IDS.length)
    expect(result.patterns.find((candidate) => candidate.id === edited.id)).toEqual(edited)
    expect(result.patterns.filter((candidate) => candidate.id === edited.id)).toHaveLength(1)
  })
})

describe('withPattern and withoutPattern', () => {
  it('adds a new pattern and updates an existing one by id', () => {
    const empty: Library = { patterns: [], questionSets: [], templates: [], calibration: [] }
    const added = withPattern(empty, pattern())
    expect(added.patterns).toEqual([pattern()])
    const changed = withPattern(added, { ...pattern(), name: 'Renamed' })
    expect(changed.patterns).toEqual([{ ...pattern(), name: 'Renamed' }])
  })

  it('removes a pattern by id and leaves the rest', () => {
    const lib: Library = { ...library(), patterns: [pattern(), { ...pattern(), id: 'pat-x' }] }
    expect(withoutPattern(lib, 'pat-x').patterns).toEqual([pattern()])
  })
})

describe('patternUsage', () => {
  it('counts opportunities across every engagement that link the pattern, by id', () => {
    const linked: Engagement = { ...engagement(), opportunities: [opportunity(), { ...opportunity(), id: 'opp-2', patternIds: ['pat-email-triage'] }] }
    const unrelated: Engagement = { ...newEngagement(), id: 'eng-2' }
    expect(patternUsage([linked, unrelated], 'pat-email-triage')).toBe(2)
    expect(patternUsage([linked, unrelated], 'pat-crm-sync')).toBe(1)
    expect(patternUsage([linked, unrelated], 'pat-nothing-links-this')).toBe(0)
  })

  it('counts a pattern named only as primary, since primaryPatternId is always also in patternIds', () => {
    const linked: Engagement = { ...engagement(), opportunities: [{ ...opportunity(), patternIds: ['pat-email-triage'], primaryPatternId: 'pat-email-triage' }] }
    expect(patternUsage([linked], 'pat-email-triage')).toBe(1)
  })
})

describe('newPattern', () => {
  it('starts with only a name and base hours set, everything else blank, low complexity and no use recorded', () => {
    const created: Pattern = newPattern('pat-9', 'Inventory sync', 6)
    expect(created).toEqual({
      id: 'pat-9',
      name: 'Inventory sync',
      category: '',
      problem: '',
      solution: '',
      architecture: '',
      requiredIntegrations: [],
      complexity: 'low',
      baseHours: 6,
      risks: [],
      clientExplanation: '',
      blueprintSkeleton: null,
      codeNotes: '',
      usedInEngagements: [],
    })
  })
})
