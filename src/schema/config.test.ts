import { describe, expect, expectTypeOf, it } from 'vitest'
import { issuePaths, roundTrip, usageRunCostLineItem } from './__fixtures__/records'
import { ConfigSchema, defaultConfig, type Config } from './config'
import type { RunCostLineItem } from './run-cost'
import type { Currency } from './traced'

describe('defaultConfig', () => {
  it('validates against ConfigSchema', () => {
    expect(ConfigSchema.parse(defaultConfig())).toEqual(defaultConfig())
  })

  it('seeds the agency identity and industries as approved', () => {
    const config = defaultConfig()
    expect(config.agency).toEqual({ name: 'AGility', email: '', website: '' })
    expect(config.agencyCurrency).toBe('EUR')
    expect(config.industries).toEqual([
      'Professional Services',
      'Software / Tech',
      'E-commerce',
      'Operations / Logistics',
    ])
  })

  it('seeds the FX table from DATA-MODEL', () => {
    expect(defaultConfig().fxRates).toEqual({
      lastUpdated: '2026-09-14',
      rates: { EUR: 1, GBP: 0.85, USD: 1.08 },
    })
  })

  it('seeds the three published pricing bands, rate and support retainer', () => {
    expect(defaultConfig().pricing).toEqual({
      targetHourlyRate: 65,
      bands: [
        { id: 'pilot', name: 'Pilot', maxHours: 15, floor: 600, ceiling: 900 },
        { id: 'full-workflow', name: 'Full workflow', maxHours: 60, floor: 1800, ceiling: 4500 },
        { id: 'custom', name: 'Custom', maxHours: null, floor: null, ceiling: null },
      ],
      supportMonthly: { floor: 350, ceiling: 800 },
    })
  })

  it('seeds the estimation, scoring and ROI defaults from DATA-MODEL', () => {
    const config = defaultConfig()
    expect(config.estimation).toEqual({
      overheads: { discovery: 0.1, testing: 0.2, documentation: 0.1, deployment: 0.08 },
      contingency: 0.15,
      fallbackPatternHours: 8,
    })
    expect(config.scoring).toEqual({
      valueCeiling: 30000,
      effortCeiling: 80,
      hoursPerEffortPoint: 1.5,
      strategicMultipliers: { direct: 1.25, indirect: 1.05, none: 1 },
    })
    expect(config.roi).toEqual({
      conservativeFactor: 0.6,
      optimisticFactor: 1.25,
      discountRate: 0.08,
      horizonYears: 3,
      paybackWarningMonths: 18,
    })
  })

  it('starts with no run-cost defaults, sync on write, and AI off', () => {
    const config = defaultConfig()
    expect(config.runCostDefaults).toEqual([])
    expect(config.storage).toEqual({ syncFolderHandleId: null, autoSyncOnWrite: true, lastSyncAt: null })
    expect(config.ai).toEqual({ provider: 'none', enabled: false })
  })

  it('survives a JSON round trip unchanged, including the unbounded custom band', () => {
    expect(ConfigSchema.parse(roundTrip(defaultConfig()))).toEqual(defaultConfig())
  })

  it('returns a fresh object on every call', () => {
    const first = defaultConfig()
    first.pricing.targetHourlyRate = 90
    first.industries.push('Healthcare')
    expect(defaultConfig().pricing.targetHourlyRate).toBe(65)
    expect(defaultConfig().industries).toHaveLength(4)
  })
})

describe('ConfigSchema', () => {
  it('rejects Infinity as a band maximum, since JSON cannot carry it', () => {
    const config = defaultConfig()
    const bands = config.pricing.bands.map((band) => (band.id === 'custom' ? { ...band, maxHours: Infinity } : band))
    expect(issuePaths(ConfigSchema, { ...config, pricing: { ...config.pricing, bands } })).toEqual([
      'pricing.bands.2.maxHours',
    ])
  })

  it('accepts only EUR as the agency currency', () => {
    expect(issuePaths(ConfigSchema, { ...defaultConfig(), agencyCurrency: 'GBP' })).toEqual(['agencyCurrency'])
  })

  it('requires a rate for every supported currency', () => {
    const config = defaultConfig()
    const { USD: _omitted, ...threeRates } = config.fxRates.rates
    expect(issuePaths(ConfigSchema, { ...config, fxRates: { ...config.fxRates, rates: threeRates } })).toEqual([
      'fxRates.rates.USD',
    ])
  })

  it('rejects an unknown AI provider', () => {
    const config = defaultConfig()
    expect(issuePaths(ConfigSchema, { ...config, ai: { ...config.ai, provider: 'gemini' } })).toEqual([
      'ai.provider',
    ])
  })

  it('applies the run-cost item rules to the defaults', () => {
    const { usageFormula: _omitted, ...withoutFormula } = usageRunCostLineItem()
    expect(issuePaths(ConfigSchema, { ...defaultConfig(), runCostDefaults: [withoutFormula] })).toEqual([
      'runCostDefaults.0.usageFormula',
    ])
  })

  it('does not run consistency rules until the field types are valid', () => {
    const config = defaultConfig()
    const invalid = { ...config, pricing: { ...config.pricing, targetHourlyRate: '65' }, roi: { ...config.roi, horizonYears: 0 } }
    expect(issuePaths(ConfigSchema, invalid)).toEqual(['pricing.targetHourlyRate'])
  })

  it('infers the spec types', () => {
    expectTypeOf<Config['agencyCurrency']>().toEqualTypeOf<'EUR'>()
    expectTypeOf<Config['fxRates']['rates']>().toEqualTypeOf<Record<Currency, number>>()
    expectTypeOf<Config['pricing']['bands'][number]>().toEqualTypeOf<{
      id: string
      name: string
      maxHours: number | null
      floor: number | null
      ceiling: number | null
    }>()
    expectTypeOf<Config['agency']['vatId']>().toEqualTypeOf<string | undefined>()
    expectTypeOf<Config['runCostDefaults']>().toEqualTypeOf<RunCostLineItem[]>()
    expectTypeOf<Config['ai']['provider']>().toEqualTypeOf<'none' | 'anthropic' | 'openai' | 'openrouter' | 'local'>()
  })
})

// Each rule test starts from the valid seed and breaks exactly one thing.
function pathsAfter(change: (config: Config) => void): string[] {
  const config = defaultConfig()
  change(config)
  return issuePaths(ConfigSchema, config)
}

function messagesAfter(change: (config: Config) => void): string[] {
  const config = defaultConfig()
  change(config)
  return ConfigSchema.safeParse(config).error?.issues.map((issue) => issue.message) ?? []
}

function band(config: Config, id: string): Config['pricing']['bands'][number] {
  const found = config.pricing.bands.find((candidate) => candidate.id === id)
  if (found === undefined) throw new Error(`seed has a '${id}' band`)
  return found
}

describe('ConfigSchema consistency rules', () => {
  it('agency.email must be empty or a valid email address', () => {
    for (const email of ['alex@', 'alex agility.dev', 'a@b', 'alex@agility.dev ']) {
      expect(pathsAfter((c) => (c.agency.email = email))).toEqual(['agency.email'])
    }
    expect(pathsAfter((c) => (c.agency.email = ''))).toEqual([])
    expect(pathsAfter((c) => (c.agency.email = 'alex@agility.dev'))).toEqual([])
  })

  it('agency.website must be empty or a valid https:// URL', () => {
    for (const website of ['http://agility.dev', 'agility.dev', 'https://agility', 'https://agility.dev ', 'javascript:alert(1)']) {
      expect(pathsAfter((c) => (c.agency.website = website))).toEqual(['agency.website'])
    }
    expect(pathsAfter((c) => (c.agency.website = ''))).toEqual([])
    expect(pathsAfter((c) => (c.agency.website = 'https://agility.dev/work'))).toEqual([])
  })

  it('every non-agency FX rate must be greater than 0', () => {
    expect(pathsAfter((c) => (c.fxRates.rates.GBP = 0))).toEqual(['fxRates.rates.GBP'])
    expect(pathsAfter((c) => (c.fxRates.rates.USD = -1.08))).toEqual(['fxRates.rates.USD'])
  })

  it('the agency currency rate must be exactly 1', () => {
    expect(pathsAfter((c) => (c.fxRates.rates.EUR = 1.1))).toEqual(['fxRates.rates.EUR'])
    expect(pathsAfter((c) => (c.fxRates.rates.EUR = 0))).toEqual(['fxRates.rates.EUR'])
  })

  it('a band floor and ceiling must be both null or both set', () => {
    expect(pathsAfter((c) => (band(c, 'pilot').ceiling = null))).toEqual(['pricing.bands.0.ceiling'])
    expect(pathsAfter((c) => (band(c, 'pilot').floor = null))).toEqual(['pricing.bands.0.floor'])
  })

  it('a band floor must not be above its ceiling', () => {
    expect(pathsAfter((c) => (band(c, 'full-workflow').floor = 5000))).toEqual(['pricing.bands.1.floor'])
    expect(pathsAfter((c) => (band(c, 'full-workflow').floor = 4500))).toEqual([])
  })

  it('exactly one band must have no max hours', () => {
    expect(pathsAfter((c) => (band(c, 'custom').maxHours = 200))).toEqual(['pricing.bands'])
    expect(pathsAfter((c) => (band(c, 'full-workflow').maxHours = null))).toEqual(['pricing.bands'])
  })

  it('the band with no max hours must sort last', () => {
    const reordered = (c: Config) => {
      c.pricing.bands = [band(c, 'pilot'), band(c, 'custom'), band(c, 'full-workflow')]
    }
    expect(pathsAfter(reordered)).toEqual(['pricing.bands.1.maxHours'])
  })

  it("the band with no max hours must have id 'custom'", () => {
    expect(pathsAfter((c) => (band(c, 'custom').id = 'bespoke'))).toEqual(['pricing.bands.2.id'])
  })

  it('the band with no max hours must have no floor and no ceiling', () => {
    const priced = (c: Config) => {
      const custom = band(c, 'custom')
      custom.floor = 5000
      custom.ceiling = 9000
    }
    expect(pathsAfter(priced)).toEqual(['pricing.bands.2.floor', 'pricing.bands.2.ceiling'])
    expect(messagesAfter(priced)).toEqual([
      'The band with no max hours must have no floor',
      'The band with no max hours must have no ceiling',
    ])
  })

  it('band max hours must not repeat', () => {
    expect(pathsAfter((c) => (band(c, 'full-workflow').maxHours = 15))).toEqual(['pricing.bands.1.maxHours'])
    expect(messagesAfter((c) => (band(c, 'full-workflow').maxHours = 15))).toEqual([
      "Band 'full-workflow' repeats max hours 15",
    ])
  })

  it('band max hours must ascend', () => {
    expect(pathsAfter((c) => (band(c, 'pilot').maxHours = 80))).toEqual(['pricing.bands.1.maxHours'])
    expect(messagesAfter((c) => (band(c, 'pilot').maxHours = 80))).toEqual([
      "Band 'full-workflow' max hours 60 must be above the previous band's 80",
    ])
  })

  it('the support retainer floor must not be above its ceiling', () => {
    expect(pathsAfter((c) => (c.pricing.supportMonthly.floor = 900))).toEqual(['pricing.supportMonthly.floor'])
    expect(pathsAfter((c) => (c.pricing.supportMonthly.floor = 800))).toEqual([])
  })

  it('the target hourly rate must be greater than 0', () => {
    expect(pathsAfter((c) => (c.pricing.targetHourlyRate = 0))).toEqual(['pricing.targetHourlyRate'])
    expect(pathsAfter((c) => (c.pricing.targetHourlyRate = -65))).toEqual(['pricing.targetHourlyRate'])
  })

  it('each overhead must be in [0, 1)', () => {
    for (const key of ['discovery', 'testing', 'documentation', 'deployment'] as const) {
      expect(pathsAfter((c) => (c.estimation.overheads[key] = 1))).toEqual([`estimation.overheads.${key}`])
      expect(pathsAfter((c) => (c.estimation.overheads[key] = -0.01))).toEqual([`estimation.overheads.${key}`])
      expect(pathsAfter((c) => (c.estimation.overheads[key] = 0))).toEqual([])
    }
  })

  it('contingency must be in [0, 1)', () => {
    expect(pathsAfter((c) => (c.estimation.contingency = 1))).toEqual(['estimation.contingency'])
    expect(pathsAfter((c) => (c.estimation.contingency = -0.15))).toEqual(['estimation.contingency'])
    expect(pathsAfter((c) => (c.estimation.contingency = 0))).toEqual([])
  })

  it('fallback pattern hours must be greater than 0', () => {
    expect(pathsAfter((c) => (c.estimation.fallbackPatternHours = 0))).toEqual(['estimation.fallbackPatternHours'])
    expect(pathsAfter((c) => (c.estimation.fallbackPatternHours = -8))).toEqual(['estimation.fallbackPatternHours'])
  })

  it('the value ceiling, effort ceiling and hours per effort point must be greater than 0', () => {
    for (const key of ['valueCeiling', 'effortCeiling', 'hoursPerEffortPoint'] as const) {
      expect(pathsAfter((c) => (c.scoring[key] = 0))).toEqual([`scoring.${key}`])
      expect(pathsAfter((c) => (c.scoring[key] = -1))).toEqual([`scoring.${key}`])
    }
  })

  it('the conservative factor must be at most 1', () => {
    expect(pathsAfter((c) => (c.roi.conservativeFactor = 1.01))).toEqual(['roi.conservativeFactor'])
    expect(pathsAfter((c) => (c.roi.conservativeFactor = 1))).toEqual([])
  })

  it('the optimistic factor must be at least 1', () => {
    expect(pathsAfter((c) => (c.roi.optimisticFactor = 0.99))).toEqual(['roi.optimisticFactor'])
    expect(pathsAfter((c) => (c.roi.optimisticFactor = 1))).toEqual([])
  })

  it('the discount rate must be in [0, 1)', () => {
    expect(pathsAfter((c) => (c.roi.discountRate = 1))).toEqual(['roi.discountRate'])
    expect(pathsAfter((c) => (c.roi.discountRate = -0.01))).toEqual(['roi.discountRate'])
    expect(pathsAfter((c) => (c.roi.discountRate = 0))).toEqual([])
  })

  it('the horizon must be a positive whole number of years', () => {
    expect(pathsAfter((c) => (c.roi.horizonYears = 0))).toEqual(['roi.horizonYears'])
    expect(pathsAfter((c) => (c.roi.horizonYears = 2.5))).toEqual(['roi.horizonYears'])
    expect(pathsAfter((c) => (c.roi.horizonYears = 1))).toEqual([])
  })
})