# Engine Specifications

Version 2. Pure functions in `src/engines/`. No storage access, no React, no
side effects, no clock except an injected one. Every function returns its inputs
alongside its outputs so the UI and documents can show the working.

## Where constants live

Constants that encode the scoring model itself live in code, as named, exported,
unit-tested constants in their engine module. Examples: the effort-points table
(§1.2), the confidence penalties and clamp (§1.3), the retainer margin threshold
(§3), the run-cost share warning threshold (§4), and the calibration sample
threshold, window and clamp (§5). Constants the operator may tune live in
`Config`: the hourly rate, pricing bands, overheads, contingency, scoring
ceilings, strategic multipliers and ROI factors.

## Currency rule

All internal math is in `Config.agencyCurrency` (EUR). Money inputs arrive as
`TracedValue` with their own currency and are converted at the top of each
engine using `Config.fxRates`. Outputs are EUR. Display layers convert back.

A `TracedValue` is money exactly when its `currency` is set. Its `unit` is display
text: engines never parse it, and a value that carries a currency converts
whatever its unit says. A value without a currency is not money and is used as
is. For validated data the two always agree, since the schema allows a currency
only on a money unit (DATA-MODEL, TracedValue); the engines still rely on
`currency` alone.

## Calibration is applied exactly once

`Pattern.baseHours` is **uncalibrated** everywhere. The scoring engine uses it
raw, so `effortScore` measures intrinsic difficulty rather than Alex's
historical accuracy. Calibration is applied **only** in the estimation engine.
Applying it in both places would compound the multiplier and inflate every quote.

## Function signatures

```ts
type CalibrationLookup = Record<string, {
  multiplier: number
  sampleCount: number         // every sample, as CalibrationRecord.sampleCount
  usableSampleCount: number   // samples with estimatedHours > 0; trust is keyed on these
  trustworthy: boolean
}>

scoreOpportunity(input: {
  opportunity: Opportunity
  processes: Process[]        // only those referenced by the opportunity
  patterns: Pick<Pattern, 'id' | 'baseHours'>[]   // only those in opportunity.patternIds
  company: Company
  config: Config
  now: string                 // ISO timestamp, see below
}): ScoringResult

estimateScope(input: {
  scored: { opportunity: Opportunity; scoring: ScoringResult }[]
  config: Config
  calibration: CalibrationLookup
  advisoryBlueprintHours: number | null   // pre-summed by the caller, see §2
  now: string
}): EstimateResult

computeRunCost(input: {
  items: RunCostLineItem[]
  deliveryModel: DeliveryModel
  supportRetainerMonthly: number | null
  config: Config
  now: string
}): RunCostResult

computeROI(input: {
  scored: { opportunity: Opportunity; scoring: ScoringResult }[]
  estimate: EstimateResult
  runCost: RunCostResult
  config: Config
  now: string
}): ROIResult

buildCalibrationLookup(records: CalibrationRecord[]): CalibrationLookup
```

No engine reads the Library. Calibration and the pattern hours that scoring
needs are passed in, and the caller pre-sums `advisoryBlueprintHours` from the
selected opportunities' blueprints.

The selected set is the opportunities named by `scope.selectedOpportunityIds`, in
that order. That list is the only record of what is in scope (DATA-MODEL,
Opportunity). An id with no opportunity has nothing to price and is skipped.
Estimation, run cost and ROI run only when a scope exists. Scoring runs for every
opportunity, selected or not, because the ranked table shows them all.

`now` exists because engines may not call `Date.now()`, which lint bans: an
engine that read the clock would give different output for the same input
depending on when it ran. The caller passes the current time as an ISO string,
and the engine copies it into `computedAt`. `now` is never part of `inputsHash`,
so identical inputs always hash identically, whenever they are computed.

## inputsHash

`inputsHash` covers exactly the fields an engine reads, not whole records or the
whole Config. An edit to a field the engine does not read (an opportunity title,
`storage.lastSyncAt`, the calibration of a pattern that is not in use) never
invalidates a cache. An edit to a field it does read always does.

The hash is cyrb53 over canonical JSON, with object keys sorted at every depth. It
is synchronous because `crypto.subtle` is async and a browser API. A golden test
pins its output. Every cached result and every document override stores a hash,
so a change to the hash function or to the serialisation would make all of them
look drifted at once. That change must ship deliberately, with a migration.

The hash covers an engine's inputs, not its behaviour. See ARCHITECTURE, Derived
data policy.

## Warnings and flags

Every warning is a `{ code, message }` object. Screens and documents act on
`code`, which comes from a fixed vocabulary for each engine and is validated by
that engine's result schema. `message` is prose for Alex: it names the figures
involved and is never parsed. Estimate `flags` are bare codes.

| Engine | Code | Raised when |
|---|---|---|
| Scoring | `MISSING_PROCESS` | an id in `processIds` has no supplied process; it contributes no value |
| Scoring | `MISSING_PATTERN` | an id in `patternIds` has no supplied pattern; its hours are not counted |
| Scoring | `NO_PROCESSES` | no linked process is supplied; the annual value is 0 |
| Scoring | `NO_HOURLY_COST` | a process has no role rate and the company no blended rate; its labour value is 0 |
| Scoring | `NON_HOURLY_COST_UNIT` | an effective hourly cost carries no `currency`, so it is not money yet is multiplied by hours |
| Scoring | `NO_PATTERN` | no linked pattern is supplied; base hours fall back (§1.2) |
| Scoring | `LOW_CONFIDENCE` | confidence is below 50 |
| Estimate flag | `UNDERPRICED` | `indicativePrice` is above a bounded band's ceiling |
| Estimate flag | `BELOW_FLOOR` | `indicativePrice` is below a bounded band's floor |
| Estimate flag | `CUSTOM_QUOTE` | the selected band is the unbounded one |
| Estimate flag | `INVALID_BAND_CONFIG` | the selected bounded band has a null floor or ceiling |
| Estimate flag | `EMPTY_SCOPE` | `totalHours === 0` |
| Estimate flag | `LOW_CONFIDENCE` | any selected opportunity's confidence is below 50 |
| Estimate flag | `UNCALIBRATED_PATTERN` | any selected opportunity's primary pattern is null, absent from the lookup, or untrustworthy |
| Run cost | `MISSING_USAGE_FORMULA` | a usage-based item has no formula; it prices at 0 |
| Run cost | `AGENCY_COST_UNDER_CLIENT_OWNED` | the client-owned column carries agency cost, whatever model is selected |
| Run cost | `RETAINER_MARGIN_THIN` | the selected model's agency annual cost exceeds 40% of the annual retainer |
| Run cost | `RETAINER_NOT_SET` | no retainer is set and the selected model's agency monthly cost is above 0 |
| ROI | `EMPTY_SCOPE` | no opportunity is selected |
| ROI | `NO_IMPLEMENTATION_COST` | the estimate prices at 0; payback and both ROI ratios are null |
| ROI | `NO_PAYBACK` | the conservative net annual benefit is 0 or less |
| ROI | `PAYBACK_TOO_LONG` | the conservative payback exceeds `paybackWarningMonths` |
| ROI | `LOW_CONFIDENCE` | the lowest confidence of a non-empty selection is below 50 |
| ROI | `RUN_COST_EATS_CASE` | the annual run cost exceeds 30% of the conservative gross value |
| ROI | `DEFAULT_COST` | any assumption that carries a currency has source `default` |

---

## 1. Scoring engine (`scoring.ts`)

### 1.1 Value

Processes are looked up by `opportunity.processIds`, and anything passed that the
opportunity does not reference is ignored. An id with no supplied process raises
`MISSING_PROCESS` and contributes nothing. With no linked process supplied at all,
`NO_PROCESSES` is raised and the annual value is 0.

Hourly cost for a process is `process.roleHourlyCost` when set, otherwise
`company.blendedHourlyCost`. Converted to EUR. When neither exists the process
raises `NO_HOURLY_COST` and its labour value is 0. A cost without a `currency` is
not money (see Currency rule), so it raises `NON_HOURLY_COST_UNIT` and is used as
is.

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
client-facing figure uses unweighted `annualValue`. `weightedValue` has no
breakdown row. The value-score row's formula names the strategic multiplier
instead of printing it, so no row pairs the multiplier with the annual value and
the weighted value cannot be recovered.

```
valueScore = clamp(round(100 × weightedValue / config.scoring.valueCeiling), 0, 100)
```

The lower clamp at 0 is defensive. Every traced value is non-negative, so valid
data cannot produce a negative score, and the clamp stops unvalidated input from
producing one. The same applies to `effortScore`.

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

baseHours = Σ(pattern.baseHours) for each supplied linked pattern
            // UNCALIBRATED
            // if none is supplied: config.estimation.fallbackPatternHours

rawBuildHours = baseHours + (effortPoints × config.scoring.hoursPerEffortPoint)

effortScore = clamp(round(100 × rawBuildHours / config.scoring.effortCeiling), 0, 100)
```

Missing-pattern fallback. Patterns are looked up by `opportunity.patternIds`. An
id with no supplied pattern raises `MISSING_PATTERN`, and its hours are not
counted. When no linked pattern is supplied, either because none is linked or
because every linked one is missing, `baseHours` falls back to
`fallbackPatternHours`, `NO_PATTERN` is raised, and the 15-point no-pattern penalty
in §1.3 applies.

The effort inputs are Alex's assessment of the build, so effort rows carry source
`estimated`. Base hours and the rows derived from them are `estimated` with a
pattern and `default` on the fallback.

### 1.3 Confidence

Count sources across every TracedValue feeding this opportunity. Each distinct
TracedValue counts once, so a company rate shared by several processes is one
assumption. `errorReductionPercent` feeds the score, and counts, only when some
process has both error inputs.

```
confidence = 100
  − (12 × count(source === 'default'))
  − (6  × count(source === 'estimated'))
  − (15 if no linked pattern is supplied)
  − (10 if the effective hourly cost source !== 'client-stated')

clamp to [15, 100]
```

The hourly-cost penalty applies once. It applies when any linked process's
effective hourly cost is missing or not client-stated, and also when no process is
supplied, since there is then no client-stated cost either.

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
    audience: 'client' | 'internal'   // defaults to 'client'
  }[]
  assumptions: TracedValue[]
  warnings: { code: ScoringWarningCode; message: string }[]
  inputsHash: string
  computedAt: string
}
```

Populate `breakdown` fully. It is what the UI renders as the expandable working
panel and what the proposal renders as its assumptions table.

### Audience

Every breakdown row carries `audience`, defaulting to `'client'`. These ranking
figures are internal:

- the Strategic multiplier row
- the Value score row
- the Effort score row
- the Priority index row
- the quadrant and `weightedValue`, which have no row, because a row holds a number

Every other row is client-facing.

**Renderer rule.** The Stage 3 renderer filters breakdown rows on `audience` and
never on label text. A client-facing document renders only rows with
`audience === 'client'`. Labels are prose and may change; the flag is the
contract. No client-facing row's value or formula may reveal an internal figure.

### Invariants (property tests)

- Increasing `automatablePercent` never decreases `annualValue`.
- Increasing any effort factor never decreases `rawBuildHours`.
- Replacing an `estimated` source with `client-stated` never decreases confidence.
- `annualValue` is 0 when no hourly cost is available and no error value exists.
- Calibration data has **no effect** on any scoring output.
- All scores are in [0, 100]; confidence in [15, 100].
- The same inputs always produce the same `inputsHash`.
- Exactly the four ranking rows are internal. No client row's formula contains the
  weighted value or the strategic multiplier.

---

## 2. Estimation engine (`estimate.ts`)

Runs over the selected set.

```
For each selected opportunity:
  entry       = calibration[opportunity.primaryPatternId]   // own keys only
  multiplier  = entry?.multiplier ?? 1.0
  trustworthy = entry?.trustworthy ?? false
  hours       = scoring.rawBuildHours × multiplier

calibratedHours = Σ(hours)
```

A null `primaryPatternId`, or a primary pattern with no entry in the lookup, is
uncalibrated by absence, not by evidence. It gets multiplier 1.0 and
`trustworthy: false`, so it raises `UNCALIBRATED_PATTERN`. Calibration for
patterns that are linked but not primary is ignored. The lookup is read by own
keys only, so a pattern id such as `constructor` cannot pick up an inherited
property.

Overheads are **additive on calibratedHours**; contingency applies **after**:

```
overheadFactor = discovery + testing + documentation + deployment
               = 0.10 + 0.20 + 0.10 + 0.08
               = 0.48

subtotalHours  = calibratedHours × (1 + overheadFactor)     // × 1.48
totalHours     = subtotalHours × (1 + contingency)          // × 1.15

// combined: totalHours = calibratedHours × 1.702
```

`overheadBreakdown` lists one entry per overhead, labelled with its Config key:
`discovery`, `testing`, `documentation`, `deployment`.

Empty scope. When `totalHours === 0`, for example when no opportunity is
selected, no band is placed. Return `price: 0`, `indicativePrice: 0`,
`bandId: null`, `effectiveHourlyRate: null` and the flag `EMPTY_SCOPE`, and skip
band placement and the band flags below. Placing an empty scope would clamp it
up to the pilot floor, and `price / totalHours` has no answer.

Band placement. `band.maxHours === null` means the band is unbounded. Config
validation (DATA-MODEL, Config, Validation) guarantees bounded bands in strictly
ascending `maxHours` order, each with a `floor` and a `ceiling`, then exactly one
unbounded band, last, with `id === 'custom'` and a `floor` and `ceiling` that are
both `null`. The estimate recognises that band by `maxHours === null`, never by
its id. Bands are compared in stored order:

```
band = first band where band.maxHours !== null && totalHours <= band.maxHours,
       else the unbounded band (maxHours === null)

indicativePrice = totalHours × config.pricing.targetHourlyRate

price = band.maxHours === null
          ? indicativePrice                        // unbounded: no published price, CUSTOM_QUOTE
          : band.floor === null || band.ceiling === null
            ? indicativePrice                      // invalid Config: INVALID_BAND_CONFIG
            : clamp(indicativePrice, band.floor, band.ceiling)
```

No unbounded band. When `config.pricing.bands` has no unbounded band,
`estimateScope` throws. A scope above every bounded band has nowhere to go, so no
price exists. ConfigSchema never produces such a Config, and this is the only
Config fault the estimate throws on.

A bounded band with a null `floor` or `ceiling` is also invalid Config that
escaped validation, but a price still exists. It is priced unclamped and flagged
`INVALID_BAND_CONFIG` rather than thrown, because a crash inside a price
calculation would hide the cause.

Flags:

- `UNDERPRICED` and `BELOW_FLOOR` are evaluated **only on a bounded band whose
  `floor` and `ceiling` are both non-null**. An unguarded comparison against
  `null` coerces it to 0, so every custom quote would read as underpriced.
  - `indicativePrice > band.ceiling` → **`UNDERPRICED`**. The work exceeds what
    the published band allows. Cut scope or quote custom. Do not silently clamp
    and eat the difference. Surface loudly in the UI and block proposal render
    until acknowledged.
  - `indicativePrice < band.floor` → `BELOW_FLOOR`, the floor applies.
- `band.maxHours === null` → `CUSTOM_QUOTE`, no published price. This is the
  same predicate that leaves the price unclamped, so an unclamped price is never
  unflagged. The band's id plays no part. It is the only band flag the unbounded
  band raises, and its `price` is `indicativePrice`.
- a bounded band with a null `floor` or `ceiling` → `INVALID_BAND_CONFIG`. Priced
  at `indicativePrice`, unclamped, with no other band flag.
- `totalHours === 0` → `EMPTY_SCOPE`. See Empty scope above; no band flag applies.
- any selected opportunity confidence < 50 → `LOW_CONFIDENCE`.
- any selected opportunity whose primary pattern is null, absent from the lookup,
  or `trustworthy === false` → `UNCALIBRATED_PATTERN`.

Flags come in a fixed order. First comes at most one of `UNDERPRICED`,
`BELOW_FLOOR`, `CUSTOM_QUOTE`, `INVALID_BAND_CONFIG` or `EMPTY_SCOPE`, then
`LOW_CONFIDENCE`, then `UNCALIBRATED_PATTERN`. The last two are still raised on an
empty scope.

### Output

```ts
interface EstimateResult {
  calibratedHours: number
  overheadBreakdown: { label: string; hours: number }[]
  contingencyHours: number
  totalHours: number
  bandId: string | null             // null when totalHours === 0 (EMPTY_SCOPE)
  indicativePrice: number
  price: number
  effectiveHourlyRate: number | null   // price / totalHours; null when totalHours === 0
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
selected opportunities. The caller computes it and passes it in, and the engine
copies it into the result to show beside `totalHours` as a sanity check. **It
never feeds the price.**

### Invariants

- `totalHours >= calibratedHours` always.
- A multiplier of 1.0 for every pattern gives `totalHours = rawHours × 1.702`.
- Doubling every `rawBuildHours` doubles `totalHours`.
- `price` is always within the band's floor and ceiling when both are non-null.
- `totalHours === 0` always gives `price: 0`, `bandId: null`,
  `effectiveHourlyRate: null` and the `EMPTY_SCOPE` flag.
- `CUSTOM_QUOTE` is raised exactly when the selected band is unbounded, always
  alone among the band flags, and then `price === indicativePrice`.

---

## 3. Run cost engine (`run-cost.ts`)

Produces the itemised infrastructure and usage sheet the proposal promises, for
each delivery model.

```ts
interface RunCostLineItem {
  id: string
  label: string
  category: 'hosting' | 'database' | 'scheduler' | 'ai' | 'monitoring'
           | 'domain' | 'third-party' | 'other'
  monthlyCost: number | null        // EUR; required unless usageBased, ignored when usageBased
  paidBy: Record<DeliveryModel, 'client' | 'agency' | 'not-applicable'>
  notes?: string
  usageBased: boolean
  usageFormula?: {                  // required when usageBased is true
    callsPerMonth: number
    avgInputTokens: number
    avgOutputTokens: number
    inputPricePerMTok: number       // EUR
    outputPricePerMTok: number      // EUR
  }
}
```

`usageFormula` is required when `usageBased` is true, because a usage-based item
is priced from the formula alone. The schema rejects a usage-based item without
one.

`monthlyCost` is required only when `usageBased` is false, and may be `null` on a
usage-based item, where it is ignored. A figure that is required and then
ignored invites a plausible number typed only to get past the field, which the
item would inherit the day it stops being usage-based. The schema rejects a
fixed item with a `null` cost.

```
itemMonthly = usageBased
  ? (callsPerMonth × avgInputTokens  / 1_000_000 × inputPricePerMTok)
  + (callsPerMonth × avgOutputTokens / 1_000_000 × outputPricePerMTok)
  : monthlyCost

clientMonthly = Σ(items where paidBy[model] === 'client')
agencyMonthly = Σ(items where paidBy[model] === 'agency')
agencyAnnual  = agencyMonthly × 12
```

A usage-based item that reaches the engine without a formula prices at 0 and
raises `MISSING_USAGE_FORMULA`.

A fixed item that reaches the engine with a `null` `monthlyCost` throws, naming
the item. It has no price at all, and pricing it at 0 would put a run cost nobody
set into the proposal. RunCostLineItemSchema never produces one.

Under `client-owned`, `agencyMonthly` should be 0.
`AGENCY_COST_UNDER_CLIENT_OWNED` checks the client-owned column **whatever model
is selected**, because that column appears in every proposal's comparison table.
The retainer warnings below judge the selected model.

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
  warnings: { code: RunCostWarningCode; message: string }[]
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

paybackMonths      = implementationCost === 0 || netAnnualBenefit <= 0
                       ? null
                       : implementationCost / (netAnnualBenefit / 12)

roiYear1  = implementationCost === 0
              ? null
              : (netAnnualBenefit − implementationCost) / implementationCost
roiYear3  = implementationCost === 0
              ? null
              : (3 × netAnnualBenefit − implementationCost) / implementationCost

npv = −implementationCost
      + Σ(t = 1..horizonYears) netAnnualBenefit / (1 + discountRate)^t
```

Zero price. A zero implementation cost has no return ratio and nothing to pay
back, so `paybackMonths`, `roiYear1` and `roiYear3` are `null` in every scenario.
A 0 would print as a real figure on a proposal. `NO_IMPLEMENTATION_COST` warns.

`lowestConfidence` is the minimum over the selected set, or 0 when nothing is
selected. `assumptions` lists each distinct TracedValue once across the set,
compared by value, because cached scoring results come back from storage as
separate objects.

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
    paybackMonths: number | null   // null when netAnnualBenefit <= 0 or the price is 0
    roiYear1: number | null        // null when the price is 0
    roiYear3: number | null        // null when the price is 0
    npv: number
  }>
  hoursSavedPerMonth: number
  hoursSavedPerYear: number
  implementationCost: number
  annualRunCost: number
  assumptions: TracedValue[]
  lowestConfidence: number
  warnings: { code: ROIWarningCode; message: string }[]
  inputsHash: string
  computedAt: string
}
```

### Warnings

Warnings that depend on a scenario are judged on **conservative**
(`ROI_WARNING_SCENARIO`), the scenario that leads every client-facing document.
Each of their messages names that scenario. The same case can pass on expected
figures and fail on conservative ones, and the proposal shows conservative.

- `NO_PAYBACK`: conservative `netAnnualBenefit <= 0`. The running cost meets or
  exceeds the value. Stop. It is keyed on the net benefit rather than on a null
  payback, because a null payback may only mean a zero price.
- `PAYBACK_TOO_LONG`: conservative `paybackMonths >
  config.roi.paybackWarningMonths`. Hard to sell, cut scope.
- `RUN_COST_EATS_CASE`: `annualRunCost >` conservative `grossAnnualValue × 0.3`.
  The running cost eats the case.

These do not depend on a scenario and name none:

- `EMPTY_SCOPE`: nothing is selected, so there is no case to make.
  `LOW_CONFIDENCE` is not raised.
- `NO_IMPLEMENTATION_COST`: the estimate prices at 0 (see Zero price).
- `LOW_CONFIDENCE`: `lowestConfidence < 50`. The case rests on guesses.
- `DEFAULT_COST`: any assumption with a `currency` has source `default`, so you are
  quoting on made-up money. Money is told by its currency alone (Currency rule).
  That cannot separate an hourly cost from a cost per error, so any default money
  figure warns.

---

## 5. Calibration engine (`calibration.ts`)

The compounding mechanism. Pure; the write-back is orchestrated by a hook.

```
usable            = samples.filter(s => s.estimatedHours > 0)
sampleCount       = samples.length
usableSampleCount = usable.length

ratios = usable.slice(-10).map(s => s.actualHours / s.estimatedHours)

multiplier = usableSampleCount < 3
               ? 1.0
               : clamp(median(ratios), 0.5, 3.0)

trustworthy = usableSampleCount >= 3
```

Median, not mean, so one catastrophic project does not permanently distort the
estimate. Clamped so a single data-entry error cannot make future quotes absurd.

`sampleCount` and `usableSampleCount`. `sampleCount` reports every sample, the
same count `CalibrationRecord.sampleCount` holds. `usableSampleCount` counts
samples with `estimatedHours > 0`, the only ones with a ratio. The window, the
median and `trustworthy` all use usable samples, so three samples of which one is
unusable are still only a hint. The schema requires a positive estimate on every
stored sample, so for validated data the two counts are equal. They differ only
for input that reached the engine unvalidated.

`buildCalibrationLookup(records)` recomputes every entry from its samples and
ignores the multiplier stored on the record, which is a cache. Records that share
a `patternId` have their samples merged in order.

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

- Fewer than 3 usable samples always yields exactly 1.0 and `trustworthy: false`,
  however many samples there are.
- The multiplier never leaves [0.5, 3.0].
- Adding a sample identical to the current median does not change the multiplier,
  while the window is not yet full. Once 10 usable samples exist, adding one evicts
  the oldest, so the window itself changes.

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

### As built

- **The rule tables are constants in code** (`signal-rules.ts`), as the literal
  above shows, not Library data. A `RegExp` cannot survive the JSON export every
  record round-trips through, and the rules encode the matching itself rather
  than anything tuned per client. There are 64 tool rules across the nine
  categories, in a fixed order, so the same text always gives the same list in
  the same order.
- **Patterns are distinctive strings**: script hosts, domains, measurement ids, or
  product names that are not ordinary words. Where a product name is a common word
  (Front, Square, Wave, Drift, Crisp, Sage, Segment, Plausible) only its host
  counts, so prose about a wave is not a detected tool. No pattern carries the `g`
  or `y` flag, whose `lastIndex` would make a second call over the same text
  differ, and none nests a quantifier, so matching is linear in the text.
- **Evidence** is the text the first matching pattern of a rule matched, cut to 80
  UTF-16 units to fit `DetectedTool.evidence`, and cut between characters so a
  surrogate pair is never split.
- **`extractSignals(text)`** returns `{ tools, pains }`, and nothing for empty
  text. A tool's confidence is its rule's, as in the literal above, and every rule
  is currently `high`. A rule's patterns mix hosts and product names, so one
  confidence cannot say which kind matched; the evidence shown beside it does, and
  nothing counts until it is confirmed. Telling the two apart would need a
  confidence per pattern, which changes the rule shape above.
- **`mergeDetectedTools(existing, found)`** adds the names the stack does not
  hold, keyed on the exact name as the schema's uniqueness rule is (DATA-MODEL,
  Company, Validation). It never touches an entry already there, so re-running
  cannot un-confirm a tool or overwrite the evidence it was confirmed on. A name
  repeated within `found` is added once, and it returns the same array when
  nothing is new.
- **Pain signals** are the five above, each written in the spellings the phrase
  appears in, including the curly apostrophe a pasted page carries. Each names the
  seeded question sets worth running and candidate patterns by the `pat-<slug>`
  ids the pattern seeds use (BUILD-PLAN, Stage 2, task 9). They are output only:
  the record has no place for them.
- **Tests:** one example per rule, so a mis-escaped pattern that can never match
  fails the suite; properties for determinism and for a detection surviving added
  text; and a large-text run guarded by the test timeout, since lint bans the
  clock in every file under `engines/`.
