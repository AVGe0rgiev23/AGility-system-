import type { DeliveryModel } from '../schema/company'
import type { Config } from '../schema/config'
import type { RunCostResult, RunCostWarningCode } from '../schema/results'
import type { RunCostLineItem } from '../schema/run-cost'
import { fmt } from './format'
import { hashInputs } from './inputs-hash'

// ENGINES §3: the agency's annual run cost may not exceed this share of the annual support
// retainer before the margin is called thin.
export const RETAINER_MARGIN_THRESHOLD = 0.4

export interface RunCostInput {
  items: RunCostLineItem[]
  deliveryModel: DeliveryModel
  // EUR. Null means no retainer has been chosen yet.
  supportRetainerMonthly: number | null
  config: Config
  // ISO timestamp from the caller. Copied to computedAt, never hashed.
  now: string
}

type ModelColumn = RunCostResult['perModel'][DeliveryModel]

// A usage-based item is priced from its formula alone; its monthlyCost is ignored. The schema
// requires the formula, so a missing one is data damage and prices at 0 (with a warning below).
export function itemMonthlyCost(item: RunCostLineItem): number {
  if (!item.usageBased) return item.monthlyCost
  const formula = item.usageFormula
  if (formula === undefined) return 0
  const inputCost = ((formula.callsPerMonth * formula.avgInputTokens) / 1_000_000) * formula.inputPricePerMTok
  const outputCost = ((formula.callsPerMonth * formula.avgOutputTokens) / 1_000_000) * formula.outputPricePerMTok
  return inputCost + outputCost
}

export function computeRunCost(input: RunCostInput): RunCostResult {
  const { items, deliveryModel, supportRetainerMonthly, config, now } = input
  const currency = config.agencyCurrency
  const warnings: RunCostResult['warnings'] = []
  const warn = (code: RunCostWarningCode, message: string): void => {
    warnings.push({ code, message })
  }

  const priced = items.map((item) => ({ item, monthly: itemMonthlyCost(item) }))
  for (const { item } of priced) {
    if (item.usageBased && item.usageFormula === undefined) {
      warn('MISSING_USAGE_FORMULA', `'${item.label}' is usage-based but has no usage formula, so it is priced at 0`)
    }
  }

  // Every item is listed under every model so the comparison table is complete; only the
  // client and agency payers are summed.
  const column = (model: DeliveryModel): ModelColumn => {
    let clientMonthly = 0
    let agencyMonthly = 0
    const lineItems = priced.map(({ item, monthly }) => {
      const paidBy = item.paidBy[model]
      if (paidBy === 'client') clientMonthly += monthly
      else if (paidBy === 'agency') agencyMonthly += monthly
      return { label: item.label, monthly, paidBy }
    })
    return { clientMonthly, agencyMonthly, agencyAnnual: agencyMonthly * 12, lineItems }
  }
  const perModel: RunCostResult['perModel'] = {
    'fully-managed': column('fully-managed'),
    'client-owned': column('client-owned'),
    hybrid: column('hybrid'),
  }
  const selected = perModel[deliveryModel]

  // The client-owned column goes into the proposal whichever model is selected, so it is
  // checked regardless of the selection.
  const clientOwnedAgency = perModel['client-owned'].agencyMonthly
  if (clientOwnedAgency > 0) {
    warn(
      'AGENCY_COST_UNDER_CLIENT_OWNED',
      `The client-owned column carries ${fmt(clientOwnedAgency)} ${currency}/month of agency cost; under client ownership the agency should pay nothing`,
    )
  }
  if (supportRetainerMonthly !== null) {
    const supportAnnual = supportRetainerMonthly * 12
    if (selected.agencyAnnual > supportAnnual * RETAINER_MARGIN_THRESHOLD) {
      warn(
        'RETAINER_MARGIN_THIN',
        `Agency run cost of ${fmt(selected.agencyAnnual)} ${currency}/year under ${deliveryModel} exceeds ${fmt(RETAINER_MARGIN_THRESHOLD * 100)}% of the ${fmt(supportAnnual)} ${currency}/year support retainer`,
      )
    }
  } else if (selected.agencyMonthly > 0) {
    warn(
      'RETAINER_NOT_SET',
      `The agency carries ${fmt(selected.agencyMonthly)} ${currency}/month of run cost under ${deliveryModel} and no support retainer is set`,
    )
  }

  // Config is read only for the currency label, which the schema fixes to EUR.
  const inputsHash = hashInputs({ items, deliveryModel, supportRetainerMonthly, agencyCurrency: currency })

  return {
    perModel,
    selectedModel: deliveryModel,
    clientMonthly: selected.clientMonthly,
    agencyMonthly: selected.agencyMonthly,
    agencyAnnual: selected.agencyAnnual,
    warnings,
    inputsHash,
    computedAt: now,
  }
}
