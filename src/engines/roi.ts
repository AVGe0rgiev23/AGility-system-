import type { Config } from '../schema/config'
import type { EstimateResult, ROIResult, ROIWarningCode, RunCostResult } from '../schema/results'
import type { TracedValue } from '../schema/traced'
import type { ScoredOpportunity } from './estimate'
import { fmt } from './format'
import { canonicalJson, hashInputs } from './inputs-hash'
import { LOW_CONFIDENCE_THRESHOLD } from './scoring'

// ENGINES §4: above this share of the gross annual value, the running cost eats the case.
export const RUN_COST_SHARE_THRESHOLD = 0.3

// §4: conservative leads every client-facing document, so it is the scenario the warnings judge.
export const ROI_WARNING_SCENARIO: keyof ROIResult['scenarios'] = 'conservative'

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
  // A zero price has no return ratio and nothing to pay back. Null says so; a 0 would print as a
  // real figure on a proposal, and computeROI warns NO_IMPLEMENTATION_COST.
  const unpriced = implementationCost === 0
  const paybackMonths = unpriced || netAnnualBenefit <= 0 ? null : implementationCost / (netAnnualBenefit / 12)
  const roiYear1 = unpriced ? null : (netAnnualBenefit - implementationCost) / implementationCost
  const roiYear3 = unpriced ? null : (3 * netAnnualBenefit - implementationCost) / implementationCost
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

  const warnings: ROIResult['warnings'] = []
  const warn = (code: ROIWarningCode, message: string): void => {
    warnings.push({ code, message })
  }
  if (scored.length === 0) {
    warn('EMPTY_SCOPE', 'No opportunity is selected, so there is no case to make')
  }
  if (implementationCost === 0) {
    warn('NO_IMPLEMENTATION_COST', 'The estimate prices at 0, so payback and the return ratios are not reported')
  }
  // Warnings that depend on a scenario are judged on the one that leads the proposal, and each
  // says so, since the same case can pass on expected figures and fail on conservative ones.
  const judged = scenarios[ROI_WARNING_SCENARIO]
  const judgedOn = `In the ${ROI_WARNING_SCENARIO} scenario`
  // Keyed on the net benefit, since a null payback may only mean a zero price.
  if (judged.netAnnualBenefit <= 0) {
    warn(
      'NO_PAYBACK',
      `${judgedOn}, the running cost of ${fmt(annualRunCost)} ${currency}/year meets or exceeds the value of ${fmt(judged.grossAnnualValue)} ${currency}/year; stop`,
    )
  } else if (judged.paybackMonths !== null && judged.paybackMonths > roi.paybackWarningMonths) {
    warn(
      'PAYBACK_TOO_LONG',
      `${judgedOn}, payback of ${fmt(judged.paybackMonths)} months exceeds ${fmt(roi.paybackWarningMonths)}; hard to sell, cut scope`,
    )
  }
  if (scored.length > 0 && lowestConfidence < LOW_CONFIDENCE_THRESHOLD) {
    warn('LOW_CONFIDENCE', `The lowest opportunity confidence is ${fmt(lowestConfidence)}; the case rests on guesses`)
  }
  if (annualRunCost > judged.grossAnnualValue * RUN_COST_SHARE_THRESHOLD) {
    warn(
      'RUN_COST_EATS_CASE',
      `${judgedOn}, the running cost of ${fmt(annualRunCost)} ${currency}/year is above ${fmt(RUN_COST_SHARE_THRESHOLD * 100)}% of the ${fmt(judged.grossAnnualValue)} ${currency}/year value`,
    )
  }
  // Money is told by its currency alone, which cannot separate an hourly cost from a cost per
  // error, so any default money figure warns: either way the case rests on a made-up cost.
  if (assumptions.some((traced) => traced.source === 'default' && traced.currency !== undefined)) {
    warn('DEFAULT_COST', 'A cost in this case is a default, not a figure the client gave; you are quoting on made-up money')
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
