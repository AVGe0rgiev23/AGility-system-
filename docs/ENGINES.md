# Engine Specifications

Version 2. Pure functions in `src/engines/`. No storage access, no React, no
side effects, no clock except an injected one. Every constant comes from
`Config`. Every function returns its inputs alongside its outputs so the UI and
documents can show the working.

## Currency rule

All internal math is in `Config.agencyCurrency` (EUR). Money inputs arrive as
`TracedValue` with their own currency and are converted at the top of each
engine using `Config.fxRates`. Outputs are EUR. Display layers convert back.

## Calibration is applied exactly once

`Pattern.baseHours` is **uncalibrated** everywhere. The scoring engine uses it
raw, so `effortScore` measures intrinsic difficulty rather than Alex's
historical accuracy. Calibration is applied **only** in the estimation engine.
Applying it in both places would compound the multiplier and inflate every quote.

## Function signatures

```ts
type CalibrationLookup = Record<string, {
  multiplier: number
  sampleCount: number
  trustworthy: boolean
}>

scoreOpportunity(input: {
  opportunity: Opportunity
  processes: Process[]        // only those referenced by the opportunity
  company: Company
  config: Config
}): ScoringResult

estimateScope(input: {
  scored: { opportunity: Opportunity; scoring: ScoringResult }[]
  config: Config
  calibration: CalibrationLookup
}): EstimateResult

computeRunCost(input: {
  items: RunCostLineItem[]
  deliveryModel: DeliveryModel
  supportRetainerMonthly: number | null
  config: Config
}): RunCostResult

computeROI(input: {
  scored: { opportunity: Opportunity; scoring: ScoringResult }[]
  estimate: EstimateResult
  runCost: RunCostResult
  config: Config
}): ROIResult

buildCalibrationLookup(records: CalibrationRecord[], config: Config): CalibrationLookup
```

No engine reads the Library. Calibration is passed in.

---

## 1. Scoring engine (`scoring.ts`)

### 1.1 Value

Hourly cost for a process is `process.roleHourlyCost` when set, otherwise
`company.blendedHourlyCost`. Converted to EUR.

For each linked `Process`:

```
hoursWastedPerMonth
  = (occurrencesPerMonth × minutesPerOccurrence × peopleInvolved) / 60

recoverableHoursPerMonth
  = hoursWastedPerMonth × (automatablePercent / 100)

annualLabourValue
  = recoverableHoursPerMonth × 12 × effectiveHourlyCost
```

Error value, only when both error inputs exist:

```
annualErrorValue
  = occurrencesPerMonth × 12
  × (errorRatePercent / 100)
  × costPerError
  × (errorReductionPercent / 100)
```

Sum across linked processes:

```
annualValue = Σ(annualLabourValue) + Σ(annualErrorValue)
```

Strategic weighting, using the highest `revenueImpact` among linked processes:

```
weightedValue = annualValue × config.scoring.strategicMultipliers[impact]
```

`weightedValue` is used **for ranking only**. Never show it to a client. Every
client-facing figure uses unweighted `annualValue`.

```
valueScore = min(100, round(100 × weightedValue / config.scoring.valueCeiling))
```

### 1.2 Effort

| Factor | Points |
|---|---|
| Each integration | +2 |
| Each integration without a public API | +4 |
| Each integration without available auth | +3 |
| Data readiness: structured / semi / unstructured | 0 / +2 / +5 |
| Each approval step | +1.5 |
| Each compliance flag | +3 |
| Volume tier: low / medium / high | 0 / +1 / +3 |
| Novelty: known / similar / new | 0 / +2 / +5 |
| Human in the loop required | +2 |

```
effortPoints = Σ(above)

baseHours = Σ(pattern.baseHours) for each linked pattern
            // UNCALIBRATED
            // if no pattern is linked: config.estimation.fallbackPatternHours

rawBuildHours = baseHours + (effortPoints × config.scoring.hoursPerEffortPoint)

effortScore = min(100, round(100 × rawBuildHours / config.scoring.effortCeiling))
```

### 1.3 Confidence

Count sources across every TracedValue feeding this opportunity.

```
confidence = 100
  − (12 × count(source === 'default'))
  − (6  × count(source === 'estimated'))
  − (15 if no pattern is linked)
  − (10 if the effective hourly cost source !== 'client-stated')

clamp to [15, 100]
```

Confidence appears wherever the numbers do, and it gates the proposal: **warn
before rendering when any selected opportunity is below 50.**

### 1.4 Priority and quadrant

```
priorityIndex = (valueScore × confidence / 100) / (0.5 + effortScore / 100)
```

| valueScore | effortScore | quadrant |
|---|---|---|
| ≥ 50 | < 50 | `quick-win` |
| ≥ 50 | ≥ 50 | `strategic` |
| < 50 | < 50 | `fill-in` |
| < 50 | ≥ 50 | `avoid` |

### Output

```ts
interface ScoringResult {
  annualValue: number           // EUR, unweighted, client-safe
  weightedValue: number         // internal ranking only
  valueScore: number
  effortPoints: number
  rawBuildHours: number         // uncalibrated
  effortScore: number
  confidence: number
  priorityIndex: number
  quadrant: 'quick-win' | 'strategic' | 'fill-in' | 'avoid'
  hoursSavedPerMonth: number
  breakdown: {
    label: string
    value: number
    unit: string
    source: Source
    formula: string
  }[]
  assumptions: TracedValue[]
  warnings: string[]
  inputsHash: string
  computedAt: string
}
```

Populate `breakdown` fully. It is what the UI renders as the expandable working
panel and what the proposal renders as its assumptions table.

### Invariants (property tests)

- Increasing `automatablePercent` never decreases `annualValue`.
- Increasing any effort factor never decreases `rawBuildHours`.
- Replacing an `estimated` source with `client-stated` never decreases confidence.
- `annualValue` is 0 when no hourly cost is available and no error value exists.
- Calibration data has **no effect** on any scoring output.
- All scores are in [0, 100]; confidence in [15, 100].
- The same inputs always produce the same `inputsHash`.

---

## 2. Estimation engine (`estimate.ts`)

Runs over the selected set.

```
For each selected opportunity:
  multiplier = calibration[opportunity.primaryPatternId]?.multiplier ?? 1.0
  hours      = scoring.rawBuildHours × multiplier

calibratedHours = Σ(hours)
```

Overheads are **additive on calibratedHours**; contingency applies **after**:

```
overheadFactor = discovery + testing + documentation + deployment
               = 0.10 + 0.20 + 0.10 + 0.08
               = 0.48

subtotalHours  = calibratedHours × (1 + overheadFactor)     // × 1.48
totalHours     = subtotalHours × (1 + contingency)          // × 1.15

// combined: totalHours = calibratedHours × 1.702
```

Band placement:

```
band = first band where totalHours <= band.maxHours, else the 'custom' band

indicativePrice = totalHours × config.pricing.targetHourlyRate

price = band.floor === null
          ? indicativePrice                      // custom band, no clamp
          : clamp(indicativePrice, band.floor, band.ceiling)
```

Flags:

- `indicativePrice > band.ceiling` → **`UNDERPRICED`**. The work exceeds what the
  published band allows. Cut scope or quote custom. Do not silently clamp and eat
  the difference. Surface loudly in the UI and block proposal render until
  acknowledged.
- `indicativePrice < band.floor` → `BELOW_FLOOR`, the floor applies.
- `band.id === 'custom'` → `CUSTOM_QUOTE`, no published price.
- any selected opportunity confidence < 50 → `LOW_CONFIDENCE`.
- any used pattern with `trustworthy === false` → `UNCALIBRATED_PATTERN`.

### Output

```ts
interface EstimateResult {
  calibratedHours: number
  overheadBreakdown: { label: string; hours: number }[]
  contingencyHours: number
  totalHours: number
  bandId: string
  indicativePrice: number
  price: number
  effectiveHourlyRate: number       // price / totalHours
  flags: EstimateFlag[]
  perOpportunity: {
    opportunityId: string
    rawHours: number
    multiplier: number
    trustworthy: boolean
    calibratedHours: number
  }[]
  advisoryBlueprintHours: number | null   // cross-check only, never used above
  inputsHash: string
  computedAt: string
}
```

`effectiveHourlyRate` is the single most important number in the app for the
health of the business. Display it prominently and track it over time.

`advisoryBlueprintHours` is the sum of `BlueprintNode.advisoryHours` for the
selected opportunities, shown beside `totalHours` as a sanity check. **It never
feeds the price.**

### Invariants

- `totalHours >= calibratedHours` always.
- A multiplier of 1.0 for every pattern gives `totalHours = rawHours × 1.702`.
- Doubling every `rawBuildHours` doubles `totalHours`.
- `price` is always within the band's floor and ceiling when both are non-null.

---

## 3. Run cost engine (`runCost.ts`)

Produces the itemised infrastructure and usage sheet the proposal promises, for
each delivery model.

```ts
interface RunCostLineItem {
  id: string
  label: string
  category: 'hosting' | 'database' | 'scheduler' | 'ai' | 'monitoring'
           | 'domain' | 'third-party' | 'other'
  monthlyCost: number               // EUR, ignored when usageBased
  paidBy: Record<DeliveryModel, 'client' | 'agency' | 'not-applicable'>
  notes?: string
  usageBased: boolean
  usageFormula?: {
    callsPerMonth: number
    avgInputTokens: number
    avgOutputTokens: number
    inputPricePerMTok: number       // EUR
    outputPricePerMTok: number      // EUR
  }
}
```

```
itemMonthly = usageBased
  ? (callsPerMonth × avgInputTokens  / 1_000_000 × inputPricePerMTok)
  + (callsPerMonth × avgOutputTokens / 1_000_000 × outputPricePerMTok)
  : monthlyCost

clientMonthly = Σ(items where paidBy[model] === 'client')
agencyMonthly = Σ(items where paidBy[model] === 'agency')
agencyAnnual  = agencyMonthly × 12
```

Under `client-owned`, `agencyMonthly` should be 0; warn if it is not.

Margin warning, **only when `supportRetainerMonthly` is set**:

```
supportAnnual = supportRetainerMonthly × 12

if (agencyAnnual > supportAnnual × 0.4) → warn RETAINER_MARGIN_THIN
```

When `supportRetainerMonthly` is null the warning does not fire, and instead
emit `RETAINER_NOT_SET` if `agencyMonthly > 0`.

### Output

```ts
interface RunCostResult {
  perModel: Record<DeliveryModel, {
    clientMonthly: number
    agencyMonthly: number
    agencyAnnual: number
    lineItems: { label: string; monthly: number; paidBy: string }[]
  }>
  selectedModel: DeliveryModel
  clientMonthly: number
  agencyMonthly: number
  agencyAnnual: number
  warnings: string[]
  inputsHash: string
  computedAt: string
}
```

The `perModel` comparison table drops straight into a proposal.

---

## 4. ROI engine (`roi.ts`)

Runs over the selected set. Clients buy projects, not line items.

```
grossAnnualValue = Σ(scoring.annualValue) for selected   // unweighted

implementationCost = estimate.price
annualRunCost      = runCost.agencyAnnual + (clientMonthly × 12)
                     // the client's total cost of ownership, both buckets

netAnnualBenefit   = grossAnnualValue − annualRunCost

paybackMonths      = netAnnualBenefit <= 0
                       ? null
                       : implementationCost / (netAnnualBenefit / 12)

roiYear1  = (netAnnualBenefit − implementationCost) / implementationCost
roiYear3  = (3 × netAnnualBenefit − implementationCost) / implementationCost

npv = −implementationCost
      + Σ(t = 1..horizonYears) netAnnualBenefit / (1 + discountRate)^t
```

### Scenarios

Applied to `grossAnnualValue`, then everything recomputed:

```
conservative = grossAnnualValue × config.roi.conservativeFactor   // 0.6
expected     = grossAnnualValue × 1.0
optimistic   = grossAnnualValue × config.roi.optimisticFactor     // 1.25
```

**Lead with conservative in every client-facing document.** Show expected
alongside. Put optimistic in an appendix or omit it. Underpromising here directly
protects the pay-only-if-it-works guarantee.

### Output

```ts
interface ROIResult {
  scenarios: Record<'conservative' | 'expected' | 'optimistic', {
    grossAnnualValue: number
    netAnnualBenefit: number
    paybackMonths: number | null
    roiYear1: number
    roiYear3: number
    npv: number
  }>
  hoursSavedPerMonth: number
  hoursSavedPerYear: number
  implementationCost: number
  annualRunCost: number
  assumptions: TracedValue[]
  lowestConfidence: number
  warnings: string[]
  inputsHash: string
  computedAt: string
}
```

### Warnings

- `paybackMonths > config.roi.paybackWarningMonths` — hard to sell, cut scope.
- `paybackMonths === null` — the running cost exceeds the value. Stop.
- `lowestConfidence < 50` — the case rests on guesses.
- `annualRunCost > grossAnnualValue × 0.3` — running cost eats the case.
- any hourly cost with source `default` — you are quoting on a made-up salary.

---

## 5. Calibration engine (`calibration.ts`)

The compounding mechanism. Pure; the write-back is orchestrated by a hook.

```
ratios = samples.slice(-10).map(s => s.actualHours / s.estimatedHours)

multiplier = sampleCount < 3
               ? 1.0
               : clamp(median(ratios), 0.5, 3.0)

trustworthy = sampleCount >= 3
```

Median, not mean, so one catastrophic project does not permanently distort the
estimate. Clamped so a single data-entry error cannot make future quotes absurd.

Surface in the UI:

- Multiplier and sample count, always together. 1.8 from three samples is a hint;
  from ten it is a fact.
- Per-pattern accuracy: which patterns Alex consistently underestimates.
- Overall drift: mean ratio across all patterns, trended over time.

### Write-back on project close

1. Group `Task.actualHours` by `Task.patternId`.
2. Append one sample per pattern, pairing summed actuals with the original
   summed estimate for that pattern.
3. Recompute multipliers.
4. Prompt to promote anything novel into a new `Pattern`.

**Block marking a project delivered while any task has `actualHours === null`.**
The system's long-term value depends entirely on this data existing. Make
skipping it deliberately awkward.

### Invariants

- Fewer than 3 samples always yields exactly 1.0 and `trustworthy: false`.
- The multiplier never leaves [0.5, 3.0].
- Adding a sample identical to the current median does not change the multiplier.

---

## 6. Signal extraction (`signals.ts`)

Deterministic keyword and pattern matching over text Alex pastes. **No network
requests, no scraping, no fetching.** Alex pastes; the app matches.

```ts
{ name: 'HubSpot', category: 'crm',
  patterns: [/hs-scripts\.com/, /hubspot/i, /\bhbspt\b/],
  confidence: 'high' }
```

Seed roughly 60 rules across CRM, email, ecommerce, support, scheduling,
accounting, analytics, forms and chat.

Pain signals matched separately: "manually", "spreadsheet", "copy and paste",
"data entry", "we're hiring an admin". Each match surfaces the relevant question
set and candidate patterns.

Output is **suggestions with visible evidence, never conclusions**. Every
`DetectedTool` starts with `confirmed: false` and only counts once Alex confirms
it.
