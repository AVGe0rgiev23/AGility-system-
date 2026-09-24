import { describe, expect, it } from 'vitest'
import { scoreOpportunity } from '../engines/scoring'
import { defaultConfig } from '../schema/config'
import type { Engagement } from '../schema/engagement'
import { businessProcess, engagement, opportunity, scoringResult } from '../schema/__fixtures__/records'
import { recomputeDerived } from '../storage/derived'
import {
  QUADRANT_PLOT,
  quadrantPoints,
  quadrantSummary,
  rankOpportunities,
  type RankedOpportunity,
  type RankingInput,
  type ScoredOpportunityRow,
} from './opportunity-ranking'

const NOW = '2026-09-24T12:00:00.000Z'
const PATTERNS = [
  { id: 'pat-email-triage', baseHours: 12 },
  { id: 'pat-crm-sync', baseHours: 8 },
]

function withOpportunities(shares: Record<string, number>, record: Engagement = engagement()): Engagement {
  return {
    ...record,
    opportunities: Object.entries(shares).map(([id, share]) => ({
      ...opportunity(),
      id,
      title: `Opportunity ${id}`,
      automatablePercent: { value: share, unit: 'percent', source: 'estimated' as const },
    })),
  }
}

function input(record: Engagement, patch: Partial<RankingInput> = {}): RankingInput {
  return { engagement: record, issues: [], pending: [], patterns: PATTERNS, config: defaultConfig(), now: NOW, ...patch }
}

function scoredOnly(ranked: readonly RankedOpportunity[]): ScoredOpportunityRow[] {
  return ranked.filter((row): row is ScoredOpportunityRow => row.kind === 'scored')
}

describe('rankOpportunities', () => {
  it('ranks by priority index, highest first, and keeps draft order on a tie', () => {
    const ranked = rankOpportunities(input(withOpportunities({ low: 5, high: 70, twin: 70 })))
    expect(ranked.map((row) => row.opportunityId)).toEqual(['high', 'twin', 'low'])
    expect(ranked.map((row) => (row.kind === 'scored' ? row.rank : null))).toEqual([1, 2, 3])
    const [high, twin, low] = scoredOnly(ranked)
    expect(high?.result.priorityIndex).toBe(twin?.result.priorityIndex)
    expect(low?.result.priorityIndex).toBeLessThan(high?.result.priorityIndex ?? 0)
  })

  it('scores exactly as the engine does, so a Save caches the same figures', () => {
    const record = withOpportunities({ a: 70 })
    const [row] = scoredOnly(rankOpportunities(input(record)))
    const [target] = record.opportunities
    if (row === undefined || target === undefined) throw new Error('nothing scored')
    expect(row.result).toEqual(scoreOpportunity({ opportunity: target, processes: record.processes, patterns: PATTERNS, company: record.company, config: defaultConfig(), now: NOW }))
    const cached = recomputeDerived(record, { config: defaultConfig(), patterns: PATTERNS, calibration: {}, now: 'later' }).engagement.opportunities[0]?.scoring
    expect(row.result.inputsHash).toBe(cached?.inputsHash)
  })

  it('titles an untitled opportunity by its place in the draft', () => {
    const record = withOpportunities({ a: 70 })
    const [held] = record.opportunities
    if (held === undefined) throw new Error('no opportunity')
    const [row] = rankOpportunities(input({ ...record, opportunities: [{ ...held, title: '' }] }))
    expect(row?.title).toBe('Opportunity 1')
  })

  it('leaves an opportunity unscored while anything it reads has a problem, and ranks it last', () => {
    const record = withOpportunities({ a: 70, b: 70 })
    const blockedBy = (patch: Partial<RankingInput>) => rankOpportunities(input(record, patch)).map((row) => (row.kind === 'blocked' ? `${row.opportunityId}:${row.problems}` : row.opportunityId))

    // Its own figures.
    expect(blockedBy({ issues: [{ path: 'opportunities.0.automatablePercent', message: 'x' }] })).toEqual(['b', 'a:1'])
    // A process it names, which both do.
    expect(blockedBy({ issues: [{ path: 'processes.0.frequency.occurrencesPerMonth', message: 'x' }] })).toEqual(['a:1', 'b:1'])
    // The company rate a process falls back on.
    expect(blockedBy({ issues: [{ path: 'company.blendedHourlyCost', message: 'x' }] })).toEqual(['a:1', 'b:1'])
    // Text still being typed counts as much as a refusal.
    expect(blockedBy({ pending: ['opportunities.1.errorReductionPercent'] })).toEqual(['a', 'b:1'])
    // Two problems are counted as two.
    expect(
      blockedBy({ issues: [{ path: 'opportunities.1.title', message: 'x' }], pending: ['opportunities.1.automatablePercent'] }),
    ).toEqual(['a', 'b:2'])
  })

  it('is not blocked by a problem in something it does not read', () => {
    const base = withOpportunities({ a: 70 })
    const record = { ...base, processes: [...base.processes, { ...businessProcess(), id: 'proc-other' }] }
    const ranked = rankOpportunities(
      input(record, {
        issues: [
          { path: 'processes.1.name', message: 'unlinked process' },
          { path: 'company.name', message: 'not read by scoring' },
          // A sibling index sharing a prefix must not match.
          { path: 'opportunities.10.title', message: 'another opportunity' },
        ],
      }),
    )
    expect(ranked.map((row) => row.kind)).toEqual(['scored'])
  })

  it('still scores an opportunity whose linked pattern the Library lacks, with the engine saying so', () => {
    const [partly] = scoredOnly(rankOpportunities(input(withOpportunities({ a: 70 }), { patterns: [{ id: 'pat-crm-sync', baseHours: 8 }] })))
    expect(partly?.result.warnings.map((warning) => warning.code)).toEqual(['MISSING_PATTERN'])

    const [none] = scoredOnly(rankOpportunities(input(withOpportunities({ a: 70 }), { patterns: [] })))
    // With none left it falls back on the default hours and loses the no-pattern confidence points.
    expect(none?.result.warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining(['MISSING_PATTERN', 'NO_PATTERN']))
    expect(none?.result.confidence).toBeLessThan(partly?.result.confidence ?? 0)
  })
})

function scoredRow(id: string, rank: number, patch: Partial<ScoredOpportunityRow['result']>): ScoredOpportunityRow {
  return { kind: 'scored', opportunityId: id, index: rank - 1, title: `Title ${id}`, rank, result: { ...scoringResult(), ...patch } }
}

describe('quadrantPoints', () => {
  it('keeps every dot inside the plot, with high value at the top and high effort to the right', () => {
    const corners = [
      scoredRow('a', 1, { valueScore: 100, effortScore: 0 }),
      scoredRow('b', 2, { valueScore: 0, effortScore: 100 }),
      scoredRow('c', 3, { valueScore: 50, effortScore: 50 }),
    ]
    const points = quadrantPoints(corners)
    const { size, margin } = QUADRANT_PLOT
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(margin)
      expect(point.x).toBeLessThanOrEqual(size - margin)
      expect(point.y).toBeGreaterThanOrEqual(margin)
      expect(point.y).toBeLessThanOrEqual(size - margin)
    }
    expect(points[0]).toMatchObject({ x: margin, y: margin })
    expect(points[1]).toMatchObject({ x: size - margin, y: size - margin })
    expect(points[2]).toMatchObject({ x: size / 2, y: size / 2 })
  })

  it('draws opportunities at the same scores as one dot naming each, and leaves out those not scored', () => {
    const points = quadrantPoints([
      scoredRow('a', 1, { valueScore: 70, effortScore: 20 }),
      scoredRow('b', 2, { valueScore: 40, effortScore: 20 }),
      scoredRow('c', 3, { valueScore: 70, effortScore: 20 }),
      { kind: 'blocked', opportunityId: 'd', index: 3, title: 'Title d', problems: 1 },
    ])
    expect(points.map((point) => point.members.map((member) => member.rank))).toEqual([[1, 3], [2]])
  })
})

describe('quadrantSummary', () => {
  it('names every scored opportunity under its quadrant, by rank, and counts those not scored', () => {
    const summary = quadrantSummary([
      scoredRow('a', 1, { quadrant: 'quick-win' }),
      scoredRow('b', 2, { quadrant: 'strategic' }),
      scoredRow('c', 3, { quadrant: 'quick-win' }),
      { kind: 'blocked', opportunityId: 'd', index: 3, title: 'Title d', problems: 2 },
    ])
    expect(summary).toBe(
      'Value score against effort score, each split at 50. Quick win: 1 Title a, 3 Title c. Strategic: 2 Title b. Fill-in: none. Avoid: none. Not scored: 1.',
    )
  })

  it('says nothing about unscored opportunities when every one is scored', () => {
    expect(quadrantSummary([scoredRow('a', 1, { quadrant: 'avoid' })])).toBe(
      'Value score against effort score, each split at 50. Quick win: none. Strategic: none. Fill-in: none. Avoid: 1 Title a.',
    )
  })
})
