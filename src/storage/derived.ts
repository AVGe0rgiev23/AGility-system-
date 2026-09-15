import type { CalibrationLookup } from '../engines/calibration'
import { estimateScope, type ScoredOpportunity } from '../engines/estimate'
import { computeROI } from '../engines/roi'
import { computeRunCost } from '../engines/run-cost'
import { scoreOpportunity } from '../engines/scoring'
import type { Config } from '../schema/config'
import type { Engagement } from '../schema/engagement'
import type { Pattern } from '../schema/library'

// ARCHITECTURE, Derived data policy: cached engine results are never authoritative. On load each
// one is recomputed and kept only when its inputsHash still matches. Pure orchestration over the
// engines, so it runs without IndexedDB; the repository decides what to write back.

export interface DerivedContext {
  config: Config
  patterns: Pick<Pattern, 'id' | 'baseHours'>[]
  calibration: CalibrationLookup
  now: string
}

export interface Recomputed {
  engagement: Engagement
  // Paths of the cached results that were replaced. Empty means the engagement is unchanged
  // and is the same object that was passed in.
  replaced: string[]
}

// A matching hash means the same inputs. The same inputs give the same figures, because a change
// to engine behaviour ships with a migration that drops the caches, so the cached result stands
// and keeps its computedAt.
function keep<T extends { inputsHash: string }>(cached: T | null, fresh: T): T {
  return cached !== null && cached.inputsHash === fresh.inputsHash ? cached : fresh
}

export function recomputeDerived(engagement: Engagement, context: DerivedContext): Recomputed {
  const { config, patterns, calibration, now } = context
  const replaced: string[] = []

  const scoredById = new Map<string, ScoredOpportunity>()
  const opportunities = engagement.opportunities.map((opportunity) => {
    const fresh = scoreOpportunity({
      opportunity,
      processes: engagement.processes,
      patterns,
      company: engagement.company,
      config,
      now,
    })
    const scoring = keep(opportunity.scoring, fresh)
    const next = scoring === opportunity.scoring ? opportunity : { ...opportunity, scoring }
    if (next !== opportunity) replaced.push(`opportunities.${opportunity.id}.scoring`)
    scoredById.set(opportunity.id, { opportunity: next, scoring })
    return next
  })

  let scope = engagement.scope
  if (scope !== null) {
    // The scope's list is the only record of what is selected. An id whose opportunity no longer
    // exists has nothing to price and is skipped.
    const scored = scope.selectedOpportunityIds.flatMap((id) => {
      const entry = scoredById.get(id)
      return entry === undefined ? [] : [entry]
    })
    const selected = new Set(scope.selectedOpportunityIds)
    const advisory = engagement.blueprints
      .filter((blueprint) => selected.has(blueprint.opportunityId))
      .flatMap((blueprint) => blueprint.nodes.flatMap((node) => (node.advisoryHours === undefined ? [] : [node.advisoryHours])))
    // Null rather than 0 when no selected blueprint gives advisory hours: there is nothing to cross-check.
    const advisoryBlueprintHours = advisory.length === 0 ? null : advisory.reduce((sum, hours) => sum + hours, 0)

    const estimate = keep(scope.estimate, estimateScope({ scored, config, calibration, advisoryBlueprintHours, now }))
    const runCost = keep(
      scope.runCost,
      computeRunCost({
        items: scope.runCostItems,
        deliveryModel: scope.deliveryModel,
        supportRetainerMonthly: scope.supportRetainerMonthly,
        config,
        now,
      }),
    )
    const roi = keep(scope.roi, computeROI({ scored, estimate, runCost, config, now }))

    if (estimate !== scope.estimate) replaced.push('scope.estimate')
    if (runCost !== scope.runCost) replaced.push('scope.runCost')
    if (roi !== scope.roi) replaced.push('scope.roi')
    if (estimate !== scope.estimate || runCost !== scope.runCost || roi !== scope.roi) {
      scope = { ...scope, estimate, runCost, roi }
    }
  }

  // updatedAt is left alone: a recompute is not an edit, and computedAt already records it.
  if (replaced.length === 0) return { engagement, replaced }
  return { engagement: { ...engagement, opportunities, scope }, replaced }
}
