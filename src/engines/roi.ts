import type { Config } from '../schema/config'
import type { EstimateResult, ROIResult, RunCostResult } from '../schema/results'
import type { TracedValue } from '../schema/traced'
import type { ScoredOpportunity } from './estimate'
import { fmt } from './format'
import { canonicalJson, hashInputs } from './inputs-hash'
import { LOW_CONFIDENCE_THRESHOLD } from './scoring'

// ENGINES §4: above this share of the gross annual value, the running cost eats the case.
export const RUN_COST_SHARE_THRESHOLD = 0.3

export interface ROIInput {
  // The selected set. Clients buy projects, not line items.
  scored: ScoredOpportunity[]
  estimate: EstimateResult
  runCost: RunCostResult
  config: Config
  // ISO timestamp from the caller. Copied to computedAt, never hashed.
  now: string
}

type Scenario = ROIResult['scenarios'][keyof ROIResult['scenarios']]

function scenario(grossAnnualValue: number, annualRunCost: number, implementationCost: number, roi: Config['roi']): Scenario {
  const netAnnualBenefit = grossAnnualValue - annualRunCost
  const paybackMonths = netAnnualBenefit <= 0 ? null : implementationCost / (netAnnualBenefit / 12)
  // A free project has no return ratio. The result schema holds plain numbers, so 0 stands in
  // and computeROI warns NO_IMPLEMENTATION_COST rather than emitting Infinity.
  const roiYear1 = implementationCost === 0 ? 0 : (netAnnualBenefit - implementationCost) / implementationCost
  const roiYear3 = implementationCost === 0 ? 0 : (3 * netAnnualBenefit - implementationCost) / implementationCost
  let npv = -implementationCost
  for (let year = 1; year <= roi.horizonYears; year++) {
    npv += netAnnualBenefit / (1 + roi.discountRate) ** year
  }
  return { grossAnnualValue, netAnnualBenefit, paybackMonths, roiYear1, roiYear3, npv }
}

export function computeROI(input: ROIInput): ROIResult {
  const { scored, estimate, runCost, config, now } = input
  const { roi } = config
  const currency = config.agencyCurrency

  // Unweighted: the strategic multiplier is for ranking and never reaches a client.
  const grossAnnualValue = scored.reduce((sum, { scoring }) => sum + scoring.annualValue, 0)
  const implementationCost = estimate.price
  // Both buckets: the client's total cost of ownership, whoever pays the bill.
  const annualRunCost = runCost.agencyAnnual + runCost.clientMonthly * 12

  const scenarios: ROIResult['scenarios'] = {
    conservative: scenario(grossAnnualValue * roi.conservativeFactor, annualRunCost, implementationCost, roi),
    expected: scenario(grossAnnualValue, annualRunCost, implementationCost, roi),
    optimistic: scenario(grossAnnualValue * roi.optimisticFactor, annualRunCost, implementationCost, roi),
  }

  const hoursSavedPerMonth = scored.reduce((sum, { scoring }) => sum + scoring.hoursSavedPerMonth, 0)

  // Deduplicated by value, not identity: cached scoring results come back from storage as
  // separate objects, and a company rate shared by two opportunities is still one assumption.
  const assumptions: TracedValue[] = []
  const seen = new Set<string>()
  for (const { scoring } of scored) {
    for (const traced of scoring.assumptions) {
      const key = canonicalJson(traced)
      if (seen.has(key)) continue
      seen.add(key)
      assumptions.push(traced)
    }
  }

  const lowestConfidence = scored.length === 0 ? 0 : Math.min(...scored.map(({ scoring }) => scoring.confidence))

  // Evaluated on the expected scenario: §4 defines the warnings on the base formulas, and the
  // scenarios are the same formulas over a scaled gross value.
  const warnings: string[] = []
  if (scored.length === 0) {
    warnings.push('EMPTY_SCOPE: no opportunity is selected, so there is no case to make')
  }
  if (implementationCost === 0) {
    warnings.push('NO_IMPLEMENTATION_COST: the estimate prices at 0, so the return ratios are reported as 0')
  }
  const expected = scenarios.expected
  if (expected.paybackMonths === null) {
    warnings.push(
      `NO_PAYBACK: the running cost of ${fmt(annualRunCost)} ${currency}/year meets or exceeds the value of ${fmt(grossAnnualValue)} ${currency}/year; stop`,
    )
  } else if (expected.paybackMonths > roi.paybackWarningMonths) {
    warnings.push(
      `PAYBACK_TOO_LONG: payback of ${fmt(expected.paybackMonths)} months exceeds ${fmt(roi.paybackWarningMonths)}; hard to sell, cut scope`,
    )
  }
  if (scored.length > 0 && lowestConfidence < LOW_CONFIDENCE_THRESHOLD) {
    warnings.push(`LOW_CONFIDENCE: the lowest opportunity confidence is ${fmt(lowestConfidence)}; the case rests on guesses`)
  }
  if (annualRunCost > grossAnnualValue * RUN_COST_SHARE_THRESHOLD) {
    warnings.push(
      `RUN_COST_EATS_CASE: the running cost of ${fmt(annualRunCost)} ${currency}/year is above ${fmt(RUN_COST_SHARE_THRESHOLD * 100)}% of the ${fmt(grossAnnualValue)} ${currency}/year value`,
    )
  }
  // Money is told by its currency alone, which cannot separate an hourly cost from a cost per
  // error, so any default money figure warns: either way the case rests on a made-up cost.
  if (assumptions.some((traced) => traced.source === 'default' && traced.currency !== undefined)) {
    warnings.push('DEFAULT_COST: a cost in this case is a default, not a figure the client gave; you are quoting on made-up money')
  }

  // Exactly the fields read above from each upstream result, so a scoring recompute with the
  // same figures, or a change to an unread part of the estimate, leaves the ROI cache valid.
  const inputsHash = hashInputs({
    scored: scored.map(({ opportunity, scoring }) => ({
      opportunityId: opportunity.id,
      annualValue: scoring.annualValue,
      hoursSavedPerMonth: scoring.hoursSavedPerMonth,
      confidence: scoring.confidence,
      assumptions: scoring.assumptions,
    })),
    implementationCost,
    runCost: { agencyAnnual: runCost.agencyAnnual, clientMonthly: runCost.clientMonthly },
    roi,
  })

  return {
    scenarios,
    hoursSavedPerMonth,
    hoursSavedPerYear: hoursSavedPerMonth * 12,
    implementationCost,
    annualRunCost,
    assumptions,
    lowestConfidence,
    warnings,
    inputsHash,
    computedAt: now,
  }
}
