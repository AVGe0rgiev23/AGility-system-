import { describe, expect, it } from 'vitest'
import { issuePaths, library } from './__fixtures__/records'
import { LibrarySchema, PatternSchema } from './library'
import { SEED_PATTERN_IDS, seedPatterns } from './seed-patterns'

describe('seedPatterns', () => {
  it('seeds the eight patterns BUILD-PLAN names, under their stable pat- ids', () => {
    expect(seedPatterns().map((pattern) => pattern.id)).toEqual([...SEED_PATTERN_IDS])
    expect(SEED_PATTERN_IDS).toEqual([
      'pat-lead-enrichment',
      'pat-email-triage',
      'pat-document-extraction',
      'pat-crm-sync',
      'pat-webhook-processing',
      'pat-approval-workflow',
      'pat-reporting-automation',
      'pat-invoice-processing',
    ])
  })

  it('validates each pattern, and all eight together in a Library', () => {
    for (const pattern of seedPatterns()) expect(issuePaths(PatternSchema, pattern), pattern.id).toEqual([])
    expect(issuePaths(LibrarySchema, { ...library(), patterns: seedPatterns() })).toEqual([])
  })

  it('names every pattern and gives it a positive, uncalibrated base-hours estimate', () => {
    for (const pattern of seedPatterns()) {
      expect(pattern.name.trim(), pattern.id).not.toBe('')
      expect(pattern.baseHours, pattern.id).toBeGreaterThan(0)
    }
  })

  it('writes client-facing prose for problem, solution and clientExplanation on every pattern', () => {
    for (const pattern of seedPatterns()) {
      expect(pattern.problem.trim(), pattern.id).not.toBe('')
      expect(pattern.solution.trim(), pattern.id).not.toBe('')
      expect(pattern.clientExplanation.trim(), pattern.id).not.toBe('')
    }
  })

  it('starts every seed pattern with no blueprint skeleton and no recorded use', () => {
    for (const pattern of seedPatterns()) {
      expect(pattern.blueprintSkeleton, pattern.id).toBeNull()
      expect(pattern.usedInEngagements, pattern.id).toEqual([])
    }
  })

  it('names each seed pattern once', () => {
    const ids = seedPatterns().map((pattern) => pattern.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('returns fresh objects on every call', () => {
    const before = seedPatterns()[0]?.risks.length ?? 0
    const first = seedPatterns()
    first[0]?.risks.pop()
    expect(seedPatterns()[0]?.risks.length).toBe(before)
    expect(first[0]?.risks.length).toBe(before - 1)
  })
})
