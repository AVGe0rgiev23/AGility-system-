import { z } from 'zod'
import { RunCostLineItemSchema } from './run-cost'
import { CurrencySchema } from './traced'

const EmailSchema = z.email()
const HttpsUrlSchema = z.url({ protocol: /^https$/, hostname: z.regexes.domain })

export const ConfigSchema = z.object({
  agency: z.object({
    name: z.string(),
    email: z.string(),
    website: z.string(),
    vatId: z.string().optional(),
  }),
  // All engine math happens in this currency.
  agencyCurrency: z.literal('EUR'),
  fxRates: z.object({
    // Shown next to every converted figure so a stale rate is visible rather than silent.
    lastUpdated: z.string(),
    // Units per 1 EUR.
    rates: z.record(CurrencySchema, z.number()),
  }),
  industries: z.array(z.string()),

  pricing: z.object({
    targetHourlyRate: z.number(),
    bands: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        // Null means unbounded. Infinity would not survive JSON, which the disk mirror and export rely on.
        maxHours: z.number().nullable(),
        // Null only on the custom band, meaning no published price: the estimate flags CUSTOM_QUOTE.
        floor: z.number().nullable(),
        ceiling: z.number().nullable(),
      }),
    ),
    supportMonthly: z.object({ floor: z.number(), ceiling: z.number() }),
  }),

  estimation: z.object({
    // Additive on calibrated hours.
    overheads: z.object({
      discovery: z.number(),
      testing: z.number(),
      documentation: z.number(),
      deployment: z.number(),
    }),
    // Applied after overheads.
    contingency: z.number(),
    // Used when no pattern is linked.
    fallbackPatternHours: z.number(),
  }),

  scoring: z.object({
    valueCeiling: z.number(),
    effortCeiling: z.number(),
    hoursPerEffortPoint: z.number(),
    // Ranking only. Client-facing figures stay unweighted.
    strategicMultipliers: z.object({
      direct: z.number(),
      indirect: z.number(),
      none: z.number(),
    }),
  }),

  roi: z.object({
    conservativeFactor: z.number(),
    optimisticFactor: z.number(),
    discountRate: z.number(),
    horizonYears: z.number(),
    paybackWarningMonths: z.number(),
  }),

  runCostDefaults: z.array(RunCostLineItemSchema),

  storage: z.object({
    // The directory handle itself is not JSON; this id points at where it is kept.
    syncFolderHandleId: z.string().nullable(),
    autoSyncOnWrite: z.boolean(),
    lastSyncAt: z.string().nullable(),
  }),

  // The app must be fully usable with provider 'none'.
  ai: z.object({
    provider: z.enum(['none', 'anthropic', 'openai', 'openrouter', 'local']),
    enabled: z.boolean(),
  }),
}).superRefine((config, ctx) => {
  // These rules live in the schema rather than the Settings screen because import, folder
  // restore and migration never pass through the UI. Each keeps a figure that reaches an
  // engine or a proposal well-defined.
  const issue = (path: (string | number)[], message: string) => {
    ctx.addIssue({ code: 'custom', path, message })
  }
  const isFraction = (value: number) => value >= 0 && value < 1

  // Printed on proposals, so a malformed value is worse than none.
  const { email, website } = config.agency
  if (email !== '' && !EmailSchema.safeParse(email).success) {
    issue(['agency', 'email'], `'${email}' is not a valid email address`)
  }
  // The URL parser trims whitespace, so a padded value would pass it yet print padded.
  if (website !== '' && (website.trim() !== website || !HttpsUrlSchema.safeParse(website).success)) {
    issue(['agency', 'website'], `'${website}' is not a valid https:// URL`)
  }

  for (const currency of CurrencySchema.options) {
    const rate = config.fxRates.rates[currency]
    if (currency === config.agencyCurrency) {
      if (rate !== 1) {
        issue(['fxRates', 'rates', currency], `${currency} is the agency currency, so its rate must be exactly 1`)
      }
    } else if (rate <= 0) {
      issue(['fxRates', 'rates', currency], `${currency} rate must be greater than 0 units per 1 ${config.agencyCurrency}`)
    }
  }

  const { pricing } = config
  if (pricing.targetHourlyRate <= 0) {
    issue(['pricing', 'targetHourlyRate'], 'Target hourly rate must be greater than 0')
  }

  // Only the custom band may go unpriced. A bounded band without a floor or ceiling would
  // price unclamped and raise no flag, publishing a figure nobody set. The custom band's
  // own prices are checked with the unbounded-band rules below.
  for (const [index, band] of pricing.bands.entries()) {
    if (band.maxHours === null) continue
    if (band.floor === null) {
      issue(['pricing', 'bands', index, 'floor'], `Band '${band.id}' needs a floor; only the custom band has no price`)
    }
    if (band.ceiling === null) {
      issue(['pricing', 'bands', index, 'ceiling'], `Band '${band.id}' needs a ceiling; only the custom band has no price`)
    }
    if (band.floor !== null && band.ceiling !== null && band.floor > band.ceiling) {
      issue(['pricing', 'bands', index, 'floor'], `Band '${band.id}' floor ${band.floor} is above its ceiling ${band.ceiling}`)
    }
  }

  // Band placement takes the first band that fits and falls through to the unbounded one, which
  // ENGINES §2 quotes by hand as CUSTOM_QUOTE. A misplaced catch-all band would swallow scopes a
  // later priced band should take, and the fixed id lets every result and document name the
  // manual quote the same way.
  const unboundedIndexes = pricing.bands.flatMap((band, index) => (band.maxHours === null ? [index] : []))
  const [unboundedIndex] = unboundedIndexes
  if (unboundedIndexes.length !== 1 || unboundedIndex === undefined) {
    issue(['pricing', 'bands'], `Exactly one band must have no max hours; found ${unboundedIndexes.length}`)
  } else {
    if (unboundedIndex !== pricing.bands.length - 1) {
      issue(['pricing', 'bands', unboundedIndex, 'maxHours'], 'The band with no max hours must be the last band')
    }
    const unbounded = pricing.bands[unboundedIndex]
    if (unbounded?.id !== 'custom') {
      issue(['pricing', 'bands', unboundedIndex, 'id'], "The band with no max hours must have id 'custom'")
    }
    // A custom quote has no published price; the estimate never clamps this band, so a floor
    // or ceiling here would look like a published price that is silently ignored.
    if (unbounded?.floor !== null) {
      issue(['pricing', 'bands', unboundedIndex, 'floor'], 'The band with no max hours must have no floor')
    }
    if (unbounded?.ceiling !== null) {
      issue(['pricing', 'bands', unboundedIndex, 'ceiling'], 'The band with no max hours must have no ceiling')
    }
  }

  // The estimate reports its band by id, so a shared id would make that band ambiguous. 'custom'
  // is reserved for the unbounded band: on a priced band it would read as a quote with no price.
  // Checked only once the unbounded band is settled, since with none a bounded 'custom' band is
  // already reported above. A misused 'custom' is reported once, not again as a duplicate.
  const seenIds = new Set<string>()
  for (const [index, band] of pricing.bands.entries()) {
    if (unboundedIndexes.length === 1 && band.maxHours !== null && band.id === 'custom') {
      issue(['pricing', 'bands', index, 'id'], "Only the band with no max hours may have id 'custom'")
      continue
    }
    if (seenIds.has(band.id)) {
      issue(['pricing', 'bands', index, 'id'], `Band id '${band.id}' is already used by an earlier band`)
    }
    seenIds.add(band.id)
  }

  let previousMaxHours: number | null = null
  for (const [index, band] of pricing.bands.entries()) {
    if (band.maxHours === null) continue
    if (previousMaxHours !== null && band.maxHours === previousMaxHours) {
      issue(['pricing', 'bands', index, 'maxHours'], `Band '${band.id}' repeats max hours ${band.maxHours}`)
    } else if (previousMaxHours !== null && band.maxHours < previousMaxHours) {
      issue(
        ['pricing', 'bands', index, 'maxHours'],
        `Band '${band.id}' max hours ${band.maxHours} must be above the previous band's ${previousMaxHours}`,
      )
    }
    previousMaxHours = band.maxHours
  }

  if (pricing.supportMonthly.floor > pricing.supportMonthly.ceiling) {
    issue(['pricing', 'supportMonthly', 'floor'], 'Support retainer floor is above its ceiling')
  }

  const { estimation } = config
  for (const [key, value] of Object.entries(estimation.overheads)) {
    if (!isFraction(value)) {
      issue(['estimation', 'overheads', key], `The ${key} overhead must be at least 0 and below 1`)
    }
  }
  if (!isFraction(estimation.contingency)) {
    issue(['estimation', 'contingency'], 'Contingency must be at least 0 and below 1')
  }
  // Used when no pattern is linked; zero would quote that opportunity as free.
  if (estimation.fallbackPatternHours <= 0) {
    issue(['estimation', 'fallbackPatternHours'], 'Fallback pattern hours must be greater than 0')
  }

  // Both ceilings divide the scores, and zero hours per effort point would make every effort factor free.
  for (const key of ['valueCeiling', 'effortCeiling', 'hoursPerEffortPoint'] as const) {
    if (config.scoring[key] <= 0) {
      issue(['scoring', key], `${key} must be greater than 0`)
    }
  }

  const { roi } = config
  if (roi.conservativeFactor > 1) {
    issue(['roi', 'conservativeFactor'], 'The conservative factor must be at most 1')
  }
  if (roi.optimisticFactor < 1) {
    issue(['roi', 'optimisticFactor'], 'The optimistic factor must be at least 1')
  }
  if (!isFraction(roi.discountRate)) {
    issue(['roi', 'discountRate'], 'The discount rate must be at least 0 and below 1')
  }
  // NPV sums over discrete years, so a fractional horizon has no meaning.
  if (!Number.isInteger(roi.horizonYears) || roi.horizonYears < 1) {
    issue(['roi', 'horizonYears'], 'The horizon must be a whole number of years, at least 1')
  }
})
export type Config = z.infer<typeof ConfigSchema>

// A fresh object per call, so editing one copy in Settings can never leak into the seed.
export function defaultConfig(): Config {
  return {
    agency: { name: 'AGility', email: '', website: '' },
    agencyCurrency: 'EUR',
    fxRates: {
      lastUpdated: '2026-09-14',
      // GBP and USD are approximations, updated by hand when they matter.
      rates: { EUR: 1, GBP: 0.85, USD: 1.08 },
    },
    industries: ['Professional Services', 'Software / Tech', 'E-commerce', 'Operations / Logistics'],
    pricing: {
      // Derived from the full workflow band at 30-60 hours.
      targetHourlyRate: 65,
      // From the published AGility site.
      bands: [
        { id: 'pilot', name: 'Pilot', maxHours: 15, floor: 600, ceiling: 900 },
        { id: 'full-workflow', name: 'Full workflow', maxHours: 60, floor: 1800, ceiling: 4500 },
        { id: 'custom', name: 'Custom', maxHours: null, floor: null, ceiling: null },
      ],
      supportMonthly: { floor: 350, ceiling: 800 },
    },
    estimation: {
      overheads: { discovery: 0.1, testing: 0.2, documentation: 0.1, deployment: 0.08 },
      contingency: 0.15,
      fallbackPatternHours: 8,
    },
    scoring: {
      valueCeiling: 30000,
      effortCeiling: 80,
      hoursPerEffortPoint: 1.5,
      strategicMultipliers: { direct: 1.25, indirect: 1.05, none: 1 },
    },
    roi: {
      conservativeFactor: 0.6,
      optimisticFactor: 1.25,
      discountRate: 0.08,
      horizonYears: 3,
      paybackWarningMonths: 18,
    },
    // The spec seeds no line items; they are added in Settings.
    runCostDefaults: [],
    storage: { syncFolderHandleId: null, autoSyncOnWrite: true, lastSyncAt: null },
    ai: { provider: 'none', enabled: false },
  }
}
