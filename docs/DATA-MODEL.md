# Data Model Specification

Version 2. This is the contract. Everything else in the app is a function of
these types. Defined with Zod in `src/schema/`, inferred into TypeScript types.
Never hand-write a type that Zod can infer.

## Principles

- Two top-level stores: **Engagements** (per company) and **Library** (global,
  cross-client), plus **Config** (single record) and **Meta** (single record).
- **One global schema version**, held in `Meta`. Individual records do not carry
  their own version. Migrations run over the whole store atomically.
- Every numeric input that feeds a client-facing number is a `TracedValue`, not
  a bare number. This is what makes proposals defensible.
- Artifacts are never stored as text. They are stored as
  `{ templateId, overrides }` and rendered on demand.
- Engine results are cached but never authoritative. See ARCHITECTURE, Derived
  data policy.

## Meta

```ts
interface Meta {
  schemaVersion: number      // the only version in the system; a whole number, 1 or more
  createdAt: string
  lastMigratedAt: string | null
  appVersion: string
}
```

## Core primitive: TracedValue

```ts
type Source = 'client-stated' | 'measured' | 'estimated' | 'default'

interface TracedValue {
  value: number           // never negative
  unit: string            // 'hours/week' | 'EUR' | 'percent' | 'count' | ... display text
  currency?: Currency     // required for a money unit, and must match it
  source: Source
  note?: string           // "Marta said 'about 4 hours, most weeks'"
  capturedAt?: string     // ISO, when the client said it
  answerId?: string       // links back to the discovery answer
}
```

A unit is a money unit when its leading segment, before any `/`, is a `Currency`
code: `EUR`, `GBP/hour` and `USD/error` are money units; `hours/week` and
`percent` are not. A money unit requires `currency`, and `currency` must equal
the code the unit implies, so `{ unit: 'GBP/hour', currency: 'EUR' }` is
rejected. Engines tell money by `currency` alone and never parse `unit` (ENGINES,
Currency rule), so a unit that names a currency must not arrive without one, and
a value whose unit and currency disagree could never be converted correctly.

`value` is never negative. Every traced figure is a count, a duration, a share or
a cost, and a negative one would run a value or effort calculation backwards
without any warning.

Confidence scoring reads `source` across all inputs. Proposals render an
assumptions table from every TracedValue used. Every figure Alex presents traces
to something the client actually said.

## Currency

The agency currency is EUR. Company currency may differ.

```ts
type Currency = 'EUR' | 'GBP' | 'USD'
```

- Every money `TracedValue` carries its `currency`.
- **All engine math happens in `Config.agencyCurrency` (EUR).** Inputs are
  converted on the way in using `Config.fxRates`.
- Display converts back to the company currency where it helps the client.
- `Config.fxRates` is a hand-maintained table of units per 1 EUR, with a
  `lastUpdated` date. GBP and USD are approximations; the UI shows the
  `lastUpdated` date next to any converted figure so a stale rate is visible
  rather than silent.
- BGN is deliberately absent. Bulgaria adopted the euro on 1 January 2026 at
  1.95583 BGN per EUR, and the euro has been its sole currency since
  1 February 2026, so Bulgarian companies are EUR companies.

## Engagement

```ts
interface Engagement {
  id: string
  createdAt: string
  updatedAt: string

  company: Company
  contacts: Contact[]
  stage: Stage
  source: LeadSource
  stageHistory: { stage: Stage; at: string; note?: string }[]

  discovery: DiscoverySession[]
  processes: Process[]
  opportunities: Opportunity[]
  blueprints: Blueprint[]

  scope: ProjectScope | null      // set when opportunities are selected
  artifacts: ArtifactSet
  project: Project | null         // exists once WON

  tags: string[]
  notes: TimestampedNote[]
  nextAction: { text: string; due?: string } | null
}

type Stage =
  | 'LEAD' | 'TEARDOWN' | 'RESEARCH' | 'DISCOVERY' | 'QUALIFIED'
  | 'PROPOSAL' | 'NEGOTIATION' | 'WON' | 'IMPLEMENTATION'
  | 'RETAINER' | 'LOST' | 'DECLINED'

type LeadSource =
  | 'teardown' | 'inbound-form' | 'linkedin' | 'referral'
  | 'outbound' | 'repeat' | 'other'
```

`DECLINED` is distinct from `LOST`: it means Alex told them honestly that custom
software was not the right answer. Track it. It is a positioning asset and a
future re-engagement list.

## Company

```ts
interface Company {
  name: string
  website?: string
  industry: string              // from Config.industries, extensible
  employeeCount?: number
  locationCountry?: string
  currency: Currency

  // Blended cost, not salary. Drives every labour calculation
  // unless a Process overrides it with a role-specific rate.
  blendedHourlyCost: TracedValue | null

  detectedStack: DetectedTool[] // from signal extraction
  statedTools: string[]
  sourceOfTruth?: string        // "HubSpot for contacts, Sheets for jobs"

  constraints: {
    compliance: string[]        // 'GDPR' | 'PCI' | 'HIPAA' | 'none'
    dataResidency?: string
    securityNotes?: string
  }

  preferredDeliveryModel?: DeliveryModel
}

interface DetectedTool {
  name: string
  category: string
  evidence: string              // the matched string, truncated to 80 chars
  confidence: 'high' | 'medium' | 'low'
  confirmed: boolean            // Alex must confirm before it counts
}

type DeliveryModel = 'fully-managed' | 'client-owned' | 'hybrid'

interface Contact {
  id: string
  name: string
  role?: string
  email?: string
  phone?: string
  isDecisionMaker: boolean
  notes?: string
}

interface TimestampedNote {
  id: string
  at: string
  body: string
  tags: string[]
}
```

## Discovery

Answers are typed fields, never prose blobs. This is what makes the data
reusable downstream.

```ts
interface DiscoverySession {
  id: string
  kind: 'teardown' | 'discovery' | 'technical' | 'follow-up'
  questionSetId: string
  heldAt: string
  attendees: string[]
  answers: Answer[]
  rawNotes: string              // freeform, always allowed alongside
  completeness: number          // 0-100, computed from required answers
}

interface Answer {
  id: string
  questionId: string
  kind: 'text' | 'number' | 'choice' | 'multi' | 'boolean' | 'duration'
  value: string | number | boolean | string[]
  traced?: TracedValue          // when the answer is a figure
  followUpTriggered: string[]   // question ids this answer unlocked
  flags: ('pain' | 'blocker' | 'opportunity' | 'risk')[]
}
```

### Question sets

Live in the Library. Support conditional branching.

```ts
interface QuestionSet {
  id: string
  name: string
  kind: DiscoverySession['kind']
  appliesTo: { industries?: string[]; minEmployees?: number }
  questions: Question[]
}

interface Question {
  id: string
  text: string
  kind: Answer['kind']
  helpText?: string
  choices?: string[]
  required: boolean
  showIf?: Condition            // shown only when this evaluates true
  mapsTo?: MappablePath         // where the answer lands, validated
  suggestsPatterns?: string[]
}

type Condition =
  | { answerId: string; equals: string | number | boolean }
  | { answerId: string; gt: number }
  | { answerId: string; includes: string }
  | { all: Condition[] }
  | { any: Condition[] }
```

**`mapsTo` is a validated union, not a free string.** A typo would silently drop
a client's answer. Define the allowed paths as a const array and derive both the
Zod enum and the TypeScript type from it:

```ts
export const MAPPABLE_PATHS = [
  'company.blendedHourlyCost',
  'company.employeeCount',
  'company.industry',
  'company.sourceOfTruth',
  'company.statedTools',
  'company.constraints.compliance',
  'company.preferredDeliveryModel',
  // process-scoped paths resolve against the process created by this session
  'process.frequency.occurrencesPerMonth',
  'process.frequency.minutesPerOccurrence',
  'process.frequency.peopleInvolved',
  'process.errorProfile.errorRatePercent',
  'process.errorProfile.costPerError',
  'process.revenueImpact',
  'process.roleHourlyCost',
] as const

export type MappablePath = typeof MAPPABLE_PATHS[number]
```

Saving a question set validates every `mapsTo` against this list and refuses
the save on a mismatch.

## Process

What the client actually does today. The raw material for opportunities.

```ts
interface Process {
  id: string
  name: string                  // "Quote request to CRM entry"
  description: string
  owner?: string                // role, not person
  frequency: {
    occurrencesPerMonth: TracedValue
    minutesPerOccurrence: TracedValue
    peopleInvolved: TracedValue
  }
  // Overrides company.blendedHourlyCost for this process.
  // A warehouse clerk and a finance manager do not cost the same.
  roleHourlyCost: TracedValue | null
  steps: ProcessStep[]
  systemsTouched: string[]
  painPoints: string[]
  errorProfile: {
    errorRatePercent: TracedValue | null
    costPerError: TracedValue | null
    errorDescription?: string
  }
  revenueImpact: 'direct' | 'indirect' | 'none'
  customerFacing: boolean
}

interface ProcessStep {
  id: string
  action: string
  system?: string
  isManual: boolean
  isBottleneck: boolean
  waitTimeMinutes?: number
}
```

## Opportunity

```ts
interface Opportunity {
  id: string
  processIds: string[]          // one opportunity can span processes
  title: string
  summary: string               // client-facing, one paragraph
  patternIds: string[]          // links to Library.patterns
  primaryPatternId: string | null   // drives calibration in estimation

  automatablePercent: TracedValue
  errorReductionPercent: TracedValue

  effortInputs: EffortInputs
  scoring: ScoringResult | null // cached, recomputed on inputsHash mismatch
}

interface EffortInputs {
  integrations: {
    name: string
    hasPublicApi: boolean
    authAvailable: boolean
    notes?: string
  }[]
  dataReadiness: 'structured' | 'semi-structured' | 'unstructured'
  approvalSteps: number         // a whole number, 0 or more
  complianceFlags: string[]
  volumeTier: 'low' | 'medium' | 'high'
  novelty: 'known-pattern' | 'similar-pattern' | 'new'
  requiresHumanInLoop: boolean
}
```

**There is no `roi` field on Opportunity.** ROI is computed over the selected set
and lives on `ProjectScope`. Clients buy projects, not line items.

**There is no `selected` flag on Opportunity.** `ProjectScope.selectedOpportunityIds`
is the only record of what is in scope. A second record of it could disagree with
the first and price a different set from the one shown.

## Blueprint

Structured nodes. The visual is generated, not drawn.

```ts
interface Blueprint {
  id: string
  opportunityId: string
  name: string
  nodes: BlueprintNode[]
  edges: { from: string; to: string; label?: string; condition?: string }[]
}

interface BlueprintNode {
  id: string
  kind: 'trigger' | 'validate' | 'fetch' | 'transform' | 'logic'
      | 'ai' | 'approval' | 'action' | 'log' | 'error'
  name: string
  purpose: string               // client-facing plain language
  input?: string
  output?: string
  service?: string
  conditions?: string
  errorHandling?: string
  retryStrategy?: string
  requiresApproval: boolean
  // ADVISORY ONLY. Never summed into the estimate or the price.
  // Displayed beside the pattern-derived estimate as a sanity cross-check.
  advisoryHours?: number
  notes?: string
}
```

## Scope, artifacts, project

```ts
interface ProjectScope {
  selectedOpportunityIds: string[]        // the only record of what is in scope
  deliveryModel: DeliveryModel
  deliverables: Deliverable[]
  exclusions: string[]
  assumptions: string[]
  phases: Phase[]

  supportRetainerMonthly: number | null   // EUR, chosen from Config band
  runCostItems: RunCostLineItem[]         // per-engagement, seeded from Config

  estimate: EstimateResult | null
  runCost: RunCostResult | null
  roi: ROIResult | null                   // computed over the selected set
}

interface Deliverable {
  id: string
  name: string
  description: string
  // The guarantee lives or dies here. Must be observable and binary.
  acceptanceCriteria: string[]
  opportunityId?: string
}

interface Phase {
  id: string
  name: string
  description: string
  order: number
  estimatedWeeks: number
}

interface ArtifactSet {
  teardown: ArtifactRef | null
  proposal: ArtifactRef | null
  sow: ArtifactRef | null
  projectPlan: ArtifactRef | null
  handoverDocs: ArtifactRef | null
  caseStudy: ArtifactRef | null
}

interface ArtifactRef {
  templateId: string
  overrides: {
    sectionId: string
    content: string
    editedAt: string
    baseInputsHash: string      // detects upstream drift, triggers conflict UI
  }[]
  lastRenderedAt: string | null
  sentAt: string | null
  version: number
}

interface Project {
  startedAt: string
  phases: Phase[]
  tasks: Task[]
  timeLog: TimeEntry[]
  status: 'active' | 'paused' | 'delivered' | 'in-support'
  deliveredAt: string | null
}

interface Task {
  id: string
  phaseId: string
  title: string
  patternId?: string            // critical: enables calibration write-back
  estimatedHours: number        // 0 or more
  actualHours: number | null    // 0 or more; null until logged
  status: 'todo' | 'doing' | 'blocked' | 'done'
  blockedReason?: string
}

interface TimeEntry {
  id: string
  taskId: string
  minutes: number
  at: string
  note?: string
}
```

## Library (global)

```ts
interface Library {
  patterns: Pattern[]
  questionSets: QuestionSet[]
  templates: DocumentTemplate[]
  calibration: CalibrationRecord[]
}

interface Pattern {
  id: string
  name: string                  // "Invoice extraction to accounting sync"
  category: string
  problem: string               // client-facing
  solution: string              // client-facing
  architecture: string          // technical
  requiredIntegrations: string[]
  complexity: 'low' | 'medium' | 'high'
  baseHours: number             // UNCALIBRATED. Calibration applies in estimation only.
                                // Greater than 0: a zero-hour pattern would make its build free.
  risks: string[]
  clientExplanation: string     // drops straight into proposals
  blueprintSkeleton: Omit<Blueprint, 'id' | 'opportunityId'> | null
  codeNotes: string
  usedInEngagements: string[]
}

interface CalibrationRecord {
  patternId: string
  samples: {
    engagementId: string
    estimatedHours: number      // greater than 0: calibration divides by it
    actualHours: number         // 0 or more
    completedAt: string
  }[]
  multiplier: number            // computed, see ENGINES
  sampleCount: number           // samples.length
  trustworthy: boolean          // usable samples >= 3, see ENGINES §5
}

interface DocumentTemplate {
  id: string
  kind: 'teardown' | 'proposal' | 'sow' | 'project-plan' | 'handover' | 'case-study'
  name: string
  sections: TemplateSection[]
}

interface TemplateSection {
  id: string
  heading: string
  body: string                  // mustache-style, resolved against a view model
  showIf?: string               // path expression; section omitted if falsy
  repeatOver?: string           // e.g. 'scope.deliverables'
}
```

## Config (single record)

Everything the operator may tune lives here. Constants that encode the scoring
model itself, such as the effort-points table (ENGINES §1.2), live in code as
named, exported, unit-tested constants in their engine module. See ENGINES,
Where constants live.

```ts
interface Config {
  agency: { name: string; email: string; website: string; vatId?: string }
  agencyCurrency: 'EUR'
  fxRates: {
    lastUpdated: string
    rates: Record<Currency, number>   // units per 1 EUR
  }
  industries: string[]

  pricing: {
    targetHourlyRate: number          // DEFAULT 65 (EUR)
    bands: {
      id: string                      // unique; 'custom' only on the unbounded band
      name: string
      maxHours: number | null         // null = unbounded; exactly one band, last, id 'custom', unpriced
      floor: number | null            // null only on the custom band = no published price
      ceiling: number | null
    }[]
    supportMonthly: { floor: number; ceiling: number }
  }

  estimation: {
    overheads: {
      discovery: number               // DEFAULT 0.10
      testing: number                 // DEFAULT 0.20
      documentation: number           // DEFAULT 0.10
      deployment: number              // DEFAULT 0.08
    }
    contingency: number               // DEFAULT 0.15, applied AFTER overheads
    fallbackPatternHours: number      // DEFAULT 8, when no pattern is linked
  }

  scoring: {
    valueCeiling: number              // DEFAULT 30000 (EUR annual)
    effortCeiling: number             // DEFAULT 80 (hours)
    hoursPerEffortPoint: number       // DEFAULT 1.5
    strategicMultipliers: {
      direct: number                  // DEFAULT 1.25
      indirect: number                // DEFAULT 1.05
      none: number                    // DEFAULT 1.00
    }
  }

  roi: {
    conservativeFactor: number        // DEFAULT 0.6
    optimisticFactor: number          // DEFAULT 1.25
    discountRate: number              // DEFAULT 0.08
    horizonYears: number              // DEFAULT 3
    paybackWarningMonths: number      // DEFAULT 18
  }

  runCostDefaults: RunCostLineItem[]

  storage: {
    syncFolderHandleId: string | null
    autoSyncOnWrite: boolean          // DEFAULT true
    lastSyncAt: string | null
  }

  ai: {
    provider: 'none' | 'anthropic' | 'openai' | 'openrouter' | 'local'
    enabled: boolean                  // DEFAULT false
  }
}
```

### Seed defaults

Pricing bands, from the published AGility site:

| Band | `id` | Max hours | Floor | Ceiling |
|---|---|---|---|---|
| Pilot | `pilot` | 15 | €600 | €900 |
| Full workflow | `full-workflow` | 60 | €1,800 | €4,500 |
| Custom | `custom` | `null` (unbounded) | `null` | `null` (flag for manual quote) |

The custom band stores `maxHours: null`, not `Infinity`. `JSON.stringify` turns
`Infinity` into `null`, so an `Infinity` would not survive the disk mirror or an
export and import round trip. `null` is the stored meaning of unbounded.

Support retainer: €350–800/month. Target hourly rate: €65, derived from the full
workflow band at 30–60 hours.

FX rates: `{ EUR: 1, GBP: 0.85, USD: 1.08 }`, `lastUpdated: '2026-09-14'`. GBP
and USD are approximations Alex updates by hand when they matter.

Agency: name `AGility`; `email` and `website` seeded empty, to be filled in
Settings. Industries: `Professional Services`, `Software / Tech`, `E-commerce`,
`Operations / Logistics`. `runCostDefaults` seeds empty. Storage seeds
`autoSyncOnWrite: true` with no folder connected. AI seeds `provider: 'none'`,
`enabled: false`.

### Validation

`ConfigSchema` enforces these rules on top of the types above. They live in the
schema, not the Settings screen, because import, folder restore and migration
never pass through the UI; Settings only renders the messages. The rules run once
every field has a valid type, and each issue names the field path shown.

| Rule | Issue path |
|---|---|
| `agency.email` is empty or a valid email address | `agency.email` |
| `agency.website` is empty or a valid `https://` URL with a domain host and no leading or trailing whitespace | `agency.website` |
| The agency currency's rate is exactly 1 | `fxRates.rates.EUR` |
| Every other FX rate is greater than 0 | `fxRates.rates.<currency>` |
| `pricing.targetHourlyRate` is greater than 0 | `pricing.targetHourlyRate` |
| Every bounded band (`maxHours` set) has a `floor` and a `ceiling` | `pricing.bands.<i>.floor`, `pricing.bands.<i>.ceiling`, on whichever is `null` |
| A band's `floor` is not above its `ceiling` | `pricing.bands.<i>.floor` |
| Exactly one band has `maxHours: null` | `pricing.bands` |
| When exactly one exists, that unbounded band is the last band | `pricing.bands.<i>.maxHours` |
| When exactly one exists, that unbounded band has `id: 'custom'` | `pricing.bands.<i>.id` |
| When exactly one exists, that unbounded band has `floor: null` and `ceiling: null` | `pricing.bands.<i>.floor`, `pricing.bands.<i>.ceiling` |
| When exactly one exists, no bounded band has `id: 'custom'` | `pricing.bands.<i>.id`, on the bounded band |
| Band ids are unique; a bounded band already reported for `id: 'custom'` is not reported again | `pricing.bands.<i>.id`, on the later band |
| Bounded `maxHours` values strictly ascend: no repeats, no decreases | `pricing.bands.<i>.maxHours`, on the later band |
| `pricing.supportMonthly.floor` is not above its `ceiling` | `pricing.supportMonthly.floor` |
| Each `estimation.overheads` value is in [0, 1) | `estimation.overheads.<key>` |
| `estimation.contingency` is in [0, 1) | `estimation.contingency` |
| `estimation.fallbackPatternHours` is greater than 0 | `estimation.fallbackPatternHours` |
| `scoring.valueCeiling`, `effortCeiling` and `hoursPerEffortPoint` are greater than 0 | `scoring.<key>` |
| `roi.conservativeFactor` is at most 1 | `roi.conservativeFactor` |
| `roi.optimisticFactor` is at least 1 | `roi.optimisticFactor` |
| `roi.discountRate` is in [0, 1) | `roi.discountRate` |
| `roi.horizonYears` is a whole number, at least 1 | `roi.horizonYears` |

Why the less obvious rules exist:

- **Unbounded band last, with id `custom` and no price.** Estimation takes the
  first band that fits and falls through to the unbounded band, which it
  recognises by `maxHours: null` and quotes by hand as `CUSTOM_QUOTE` (ENGINES
  §2). A misplaced catch-all band would swallow scopes a later priced band should
  take. A floor or ceiling on it would look like a published price that the
  estimate silently ignores. The fixed id lets every result and document name the
  manual quote the same way.
- **Unique band ids, with `custom` reserved.** The estimate reports its band by
  id, so a shared id would make that band ambiguous. On a priced band, `custom`
  would read as a quote with no price.
- **Only the custom band goes unpriced.** The estimate clamps a bounded band's
  price between its floor and ceiling. A bounded band without them would price
  unclamped and raise no flag, publishing a figure nobody set.
- **`fallbackPatternHours` above 0.** It is used when no pattern is linked; zero
  would quote that opportunity as free.
- **Whole-number horizon.** NPV sums over discrete years, so a fractional horizon
  has no meaning.
- **Positive scoring ceilings.** Both ceilings divide the scores, and zero hours
  per effort point would make every effort factor free.

## Storage layout

IndexedDB (Dexie), tables: `engagements`, `library`, `config`, `meta`.

| Table | Holds | Key |
|---|---|---|
| `engagements` | one `Engagement` per record | its `id` |
| `library` | the `Library` record | `library` |
| `config` | the `Config` record, and the sync folder handle | `config`; `sync-folder-handle`, as named by `Config.storage.syncFolderHandleId` |
| `meta` | the `Meta` record | `meta` |

The folder handle is a browser object, not data. It is never exported or
mirrored, and a whole-store replace leaves it where it is. Dexie's own structural
version counts table and key changes only, and is unrelated to
`Meta.schemaVersion`.

Disk mirror:

```
agility-os-data/
  .schema-version            single global version, matches Meta
  meta.json
  config.json
  library/
    patterns.json
    question-sets.json
    templates.json
    calibration.json
  engagements/
    <slug>-<shortid>/
      engagement.json
      rendered/              EXPORT ONLY. Never read back. Safe to delete.
        proposal-v3.html
        sow-v1.html
```

Keep that folder as a private git repo.

Files are pretty-printed JSON with a trailing newline, in schema field order, so
git diffs stay readable. `<slug>` is the company name folded to lowercase ASCII
letters, digits and hyphens, at most 40 characters, or `engagement` when nothing
is left. `<shortid>` is the first 8 letters and digits of the engagement id,
lowercased. `meta.json` is in the mirror so a restore from the folder can rebuild
the whole store, `createdAt` and `lastMigratedAt` included.

## Migration rule

Migrations operate on the **whole store**, never a single record. The current
version is `CURRENT_SCHEMA_VERSION` in `src/schema/version.ts`.

`src/schema/migrations/` holds one file per version bump. Each exports a
migration `(store: unknown) => unknown` that takes the whole store at version N
and returns it at N + 1, including setting `meta.schemaVersion` to N + 1. Each is
registered in `MIGRATIONS` in `run-migrations.ts`, keyed by the version it
upgrades from.

`runMigrations(store, from)` applies every registered step from `from` up to
the current version and validates the result against the whole-store schema.
It refuses, with a `MigrationError` and a plain message:

- **Data newer than the app.** When `from` is above the current version, the
  message names both versions and says the app is older than the data. Parsing
  it anyway would let Zod strip every field this app does not know, and the
  downgrade would look like success.
- **Mismatched versions.** A `meta.schemaVersion` that disagrees with `from`, for
  example `.schema-version` on disk disagreeing with the data.
- **An invalid starting version.** Anything but a whole number of 1 or more.
- **A broken chain.** A missing step or a step that throws, named by its
  versions, with the original error as the cause.
- **A bad result.** A result that fails validation, with the Zod issues attached,
  or whose `meta.schemaVersion` was not advanced to the current version.

Steps run on a copy, so a failure leaves the caller's data untouched.

A migration never drops or repairs data to make it validate. Data that breaks a
rule of the new version stays as it is and fails with its issue paths. Version 2
(`v1-to-v2.ts`) sets exactly `opportunities[].scoring`, `scope.estimate`,
`scope.runCost` and `scope.roi` to `null` and touches nothing else, because the
engines' behaviour changed (ARCHITECTURE, Derived data policy).
`runMigrations` never writes. Storage writes the result back atomically and
stamps `Meta.lastMigratedAt` only once it returns. An optional third argument,
`{ migrations, current }`, exists so tests can exercise the step loop with a
fake chain.

A frozen fixture of the full store at every version lives in
`src/schema/__fixtures__/store-vN.json` and is migrated in tests. A fixture is
never edited after its version ships. The tests require a fixture for every
version up to current and a migration for every version below it, so a schema
bump cannot land without both.
