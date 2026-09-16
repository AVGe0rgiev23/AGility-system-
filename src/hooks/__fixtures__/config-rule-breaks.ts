import { runCostLineItem, usageRunCostLineItem } from '../../schema/__fixtures__/records'
import type { Config } from '../../schema/config'

// One break per rule in DATA-MODEL's Config Validation table, plus the two run-cost item rules, each
// with every issue path it raises. Shared by the form model and the Settings render tests, so both
// prove the same thing: an issue for any rule has somewhere to show.

export interface ConfigRuleBreak {
  rule: string
  // Mutates a fresh defaultConfig().
  apply: (config: Config) => void
  paths: string[]
}

function band(config: Config, index: number): Config['pricing']['bands'][number] {
  const found = config.pricing.bands[index]
  if (found === undefined) throw new Error(`the seed has a band at ${index}`)
  return found
}

export const CONFIG_RULE_BREAKS: readonly ConfigRuleBreak[] = [
  { rule: 'agency.email is empty or a valid email address', apply: (c) => (c.agency.email = 'alex@'), paths: ['agency.email'] },
  { rule: 'agency.website is empty or a valid https:// URL', apply: (c) => (c.agency.website = 'http://agility.dev'), paths: ['agency.website'] },
  { rule: "the agency currency's rate is exactly 1", apply: (c) => (c.fxRates.rates.EUR = 1.1), paths: ['fxRates.rates.EUR'] },
  {
    rule: 'every other FX rate is greater than 0',
    apply: (c) => {
      c.fxRates.rates.GBP = 0
      c.fxRates.rates.USD = -1
    },
    paths: ['fxRates.rates.GBP', 'fxRates.rates.USD'],
  },
  { rule: 'pricing.targetHourlyRate is greater than 0', apply: (c) => (c.pricing.targetHourlyRate = 0), paths: ['pricing.targetHourlyRate'] },
  {
    rule: 'every bounded band has a floor and a ceiling',
    apply: (c) => {
      band(c, 0).floor = null
      band(c, 0).ceiling = null
    },
    paths: ['pricing.bands.0.floor', 'pricing.bands.0.ceiling'],
  },
  { rule: "a band's floor is not above its ceiling", apply: (c) => (band(c, 1).floor = 5000), paths: ['pricing.bands.1.floor'] },
  { rule: 'exactly one band has no max hours', apply: (c) => (band(c, 1).maxHours = null), paths: ['pricing.bands'] },
  {
    rule: 'the unbounded band is the last band',
    apply: (c) => (c.pricing.bands = [band(c, 0), band(c, 2), band(c, 1)]),
    paths: ['pricing.bands.1.maxHours'],
  },
  { rule: "the unbounded band has id 'custom'", apply: (c) => (band(c, 2).id = 'bespoke'), paths: ['pricing.bands.2.id'] },
  {
    rule: 'the unbounded band has no floor and no ceiling',
    apply: (c) => {
      band(c, 2).floor = 5000
      band(c, 2).ceiling = 9000
    },
    paths: ['pricing.bands.2.floor', 'pricing.bands.2.ceiling'],
  },
  { rule: "no bounded band has id 'custom'", apply: (c) => (band(c, 0).id = 'custom'), paths: ['pricing.bands.0.id'] },
  { rule: 'band ids are unique', apply: (c) => (band(c, 1).id = 'pilot'), paths: ['pricing.bands.1.id'] },
  { rule: 'bounded max hours do not repeat', apply: (c) => (band(c, 1).maxHours = 15), paths: ['pricing.bands.1.maxHours'] },
  { rule: 'bounded max hours do not decrease', apply: (c) => (band(c, 0).maxHours = 80), paths: ['pricing.bands.1.maxHours'] },
  { rule: 'the support retainer floor is not above its ceiling', apply: (c) => (c.pricing.supportMonthly.floor = 900), paths: ['pricing.supportMonthly.floor'] },
  {
    rule: 'each overhead is in [0, 1)',
    apply: (c) => {
      c.estimation.overheads.discovery = 1
      c.estimation.overheads.testing = -0.2
      c.estimation.overheads.documentation = 1.5
      c.estimation.overheads.deployment = 8
    },
    paths: ['estimation.overheads.discovery', 'estimation.overheads.testing', 'estimation.overheads.documentation', 'estimation.overheads.deployment'],
  },
  { rule: 'contingency is in [0, 1)', apply: (c) => (c.estimation.contingency = 15), paths: ['estimation.contingency'] },
  { rule: 'fallback pattern hours are greater than 0', apply: (c) => (c.estimation.fallbackPatternHours = 0), paths: ['estimation.fallbackPatternHours'] },
  {
    rule: 'the scoring ceilings and hours per effort point are greater than 0',
    apply: (c) => {
      c.scoring.valueCeiling = 0
      c.scoring.effortCeiling = -80
      c.scoring.hoursPerEffortPoint = 0
    },
    paths: ['scoring.valueCeiling', 'scoring.effortCeiling', 'scoring.hoursPerEffortPoint'],
  },
  { rule: 'the conservative factor is at most 1', apply: (c) => (c.roi.conservativeFactor = 1.2), paths: ['roi.conservativeFactor'] },
  { rule: 'the optimistic factor is at least 1', apply: (c) => (c.roi.optimisticFactor = 0.9), paths: ['roi.optimisticFactor'] },
  { rule: 'the discount rate is in [0, 1)', apply: (c) => (c.roi.discountRate = 8), paths: ['roi.discountRate'] },
  { rule: 'the horizon is a whole number of years, at least 1', apply: (c) => (c.roi.horizonYears = 2.5), paths: ['roi.horizonYears'] },
  {
    rule: 'a usage-based run-cost item has a formula',
    apply: (c) => {
      const { usageFormula: _dropped, ...item } = usageRunCostLineItem()
      c.runCostDefaults = [item]
    },
    paths: ['runCostDefaults.0.usageFormula'],
  },
  {
    rule: 'a run-cost item that is not usage-based has a monthly cost',
    apply: (c) => (c.runCostDefaults = [{ ...runCostLineItem(), monthlyCost: null }]),
    paths: ['runCostDefaults.0.monthlyCost'],
  },
]
