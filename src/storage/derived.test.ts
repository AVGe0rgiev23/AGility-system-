import { describe, expect, it } from 'vitest'
import { buildCalibrationLookup } from '../engines/calibration'
import { blueprint, engagement, library, opportunity } from '../schema/__fixtures__/records'
import { defaultConfig } from '../schema/config'
import type { Engagement } from '../schema/engagement'
import { recomputeDerived, type DerivedContext } from './derived'

const NOW = '2026-09-16T09:00:00.000Z'
const LATER = '2026-09-17T09:00:00.000Z'

function context(overrides: Partial<DerivedContext> = {}): DerivedContext {
  return {
    config: defaultConfig(),
    patterns: [
      { id: 'pat-email-triage', baseHours: 12 },
      { id: 'pat-crm-sync', baseHours: 9 },
    ],
    calibration: buildCalibrationLookup(library().calibration),
    now: NOW,
    ...overrides,
  }
}

// As a v1 store looks after the v2 migration: every cache dropped.
function uncached(): Engagement {
  const record = engagement()
  const scope = record.scope
  if (scope === null) throw new Error('fixture engagement has a scope')
  return {
    ...record,
    opportunities: record.opportunities.map((entry) => ({ ...entry, scoring: null })),
    scope: { ...scope, estimate: null, runCost: null, roi: null },
  }
}

function scopeOf(record: Engagement): NonNullable<Engagement['scope']> {
  if (record.scope === null) throw new Error('expected a scope')
  return record.scope
}

describe('recomputeDerived', () => {
  it('replaces every cached result whose inputsHash is stale', () => {
    // The fixture's caches carry placeholder hashes that no engine produces.
    const { engagement: next, replaced } = recomputeDerived(engagement(), context())
    expect(replaced).toEqual(['opportunities.opp-1.scoring', 'scope.estimate', 'scope.runCost', 'scope.roi'])
    expect(next.opportunities[0]?.scoring?.inputsHash).not.toBe('h-scoring')
    expect(next.opportunities[0]?.scoring?.computedAt).toBe(NOW)
    const scope = scopeOf(next)
    for (const result of [scope.estimate, scope.runCost, scope.roi]) {
      expect(result?.computedAt).toBe(NOW)
    }
  })

  it('computes every result that was never cached', () => {
    const { engagement: next, replaced } = recomputeDerived(uncached(), context())
    expect(replaced).toEqual(['opportunities.opp-1.scoring', 'scope.estimate', 'scope.runCost', 'scope.roi'])
    expect(next.opportunities[0]?.scoring).not.toBeNull()
    expect(scopeOf(next).roi).not.toBeNull()
  })

  it('keeps cached results whose hash still matches, returning the same engagement', () => {
    const first = recomputeDerived(engagement(), context()).engagement
    const second = recomputeDerived(first, context({ now: LATER }))
    expect(second.replaced).toEqual([])
    expect(second.engagement).toBe(first)
    expect(second.engagement.opportunities[0]?.scoring?.computedAt).toBe(NOW)
  })

  it('recomputes the price after a Config change, and only what the change reaches', () => {
    const first = recomputeDerived(engagement(), context()).engagement
    const config = defaultConfig()
    config.pricing.targetHourlyRate = 80
    const { engagement: next, replaced } = recomputeDerived(first, context({ config, now: LATER }))
    // The rate feeds the estimate, and the price feeds ROI. Scoring and run cost do not read it.
    expect(replaced).toEqual(['scope.estimate', 'scope.roi'])
    expect(scopeOf(next).estimate?.computedAt).toBe(LATER)
    expect(scopeOf(next).runCost?.computedAt).toBe(NOW)
  })

  it('never touches updatedAt, since a recompute is not an edit', () => {
    const record = engagement()
    expect(recomputeDerived(record, context()).engagement.updatedAt).toBe(record.updatedAt)
  })

  it('prices exactly the opportunities in scope.selectedOpportunityIds, skipping ids that no longer exist', () => {
    const record = uncached()
    const second = { ...opportunity(), id: 'opp-2', title: 'Second', scoring: null }
    record.opportunities = [...record.opportunities, second]
    record.scope = { ...scopeOf(record), selectedOpportunityIds: ['opp-2', 'opp-gone'] }
    const next = recomputeDerived(record, context()).engagement
    // Both opportunities are scored for the ranked table; only the selected one is priced.
    expect(next.opportunities.map((entry) => entry.scoring === null)).toEqual([false, false])
    expect(scopeOf(next).estimate?.perOpportunity.map((entry) => entry.opportunityId)).toEqual(['opp-2'])
  })

  it('sums advisory hours over the selected opportunities’ blueprints only, or gives null when none has any', () => {
    const record = uncached()
    // The fixture blueprint belongs to opp-1 and has one node advising 3 hours.
    const unselected = { ...blueprint(), id: 'bp-2', opportunityId: 'opp-other' }
    record.blueprints = [...record.blueprints, unselected]
    expect(scopeOf(recomputeDerived(record, context()).engagement).estimate?.advisoryBlueprintHours).toBe(3)

    const silent = uncached()
    silent.blueprints = [{ ...blueprint(), nodes: blueprint().nodes.map(({ advisoryHours: _omitted, ...node }) => node) }]
    expect(scopeOf(recomputeDerived(silent, context()).engagement).estimate?.advisoryBlueprintHours).toBeNull()
  })

  it('recomputes only scoring for an engagement with no scope', () => {
    const record = { ...uncached(), scope: null }
    const { engagement: next, replaced } = recomputeDerived(record, context())
    expect(replaced).toEqual(['opportunities.opp-1.scoring'])
    expect(next.scope).toBeNull()
  })

  it('does not mutate its input', () => {
    const record = engagement()
    const copy = structuredClone(record)
    recomputeDerived(record, context())
    expect(record).toEqual(copy)
  })
})
