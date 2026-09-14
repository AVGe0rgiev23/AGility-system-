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

  it('seeds the FX table from DATA-MODEL, with BGN at its hard peg', () => {
    expect(defaultConfig().fxRates).toEqual({
      lastUpdated: '2026-09-14',
      rates: { EUR: 1, BGN: 1.95583, GBP: 0.85, USD: 1.08 },
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
    expect(issuePaths(ConfigSchema, { ...defaultConfig(), agencyCurrency: 'BGN' })).toEqual(['agencyCurrency'])
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
