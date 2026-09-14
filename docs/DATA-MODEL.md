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
  schemaVersion: number      // the only version in the system
  createdAt: string
  lastMigratedAt: string | null
  appVersion: string
}
```

## Core primitive: TracedValue

```ts
type Source = 'client-stated' | 'measured' | 'estimated' | 'default'

interface TracedValue {
  value: number
  unit: string            // 'hours/week' | 'EUR' | 'percent' | 'count' | ...
  currency?: Currency     // required when unit is a money unit
  source: Source
  note?: string           // "Marta said 'about 4 hours, most weeks'"
  capturedAt?: string     // ISO, when the client said it
  answerId?: string       // links back to the discovery answer
}
```

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
  selected: boolean             // included in the current scope
}

interface EffortInputs {
  integrations: {
    name: string
    hasPublicApi: boolean
    authAvailable: boolean
    notes?: string
  }[]
  dataReadiness: 'structured' | 'semi-structured' | 'unstructured'
  approvalSteps: number
  complianceFlags: string[]
  volumeTier: 'low' | 'medium' | 'high'
  novelty: 'known-pattern' | 'similar-pattern' | 'new'
  requiresHumanInLoop: boolean
}
```

**There is no `roi` field on Opportunity.** ROI is computed over the selected set
and lives on `ProjectScope`. Clients buy projects, not line items.

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
  selectedOpportunityIds: string[]
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
  estimatedHours: number
  actualHours: number | null
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
    estimatedHours: number
    actualHours: number
    completedAt: string
  }[]
  multiplier: number            // computed, see ENGINES
  sampleCount: number
  trustworthy: boolean          // sampleCount >= 3
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

Everything tunable lives here. No magic numbers in code.

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
      id: string
      name: string
      maxHours: number
      floor: number
      ceiling: number
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

| Band | Max hours | Floor | Ceiling |
|---|---|---|---|
| Pilot | 15 | €600 | €900 |
| Full workflow | 60 | €1,800 | €4,500 |
| Custom | Infinity | null | null (flag for manual quote) |

Support retainer: €350–800/month. Target hourly rate: €65, derived from the full
workflow band at 30–60 hours.

FX rates: `{ EUR: 1, GBP: 0.85, USD: 1.08 }`. GBP and USD are approximations
Alex updates by hand when they matter.

## Storage layout

IndexedDB (Dexie), tables: `engagements`, `library`, `config`, `meta`.

Disk mirror:

```
agility-os-data/
  .schema-version            single global version, matches Meta
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

## Migration rule

`src/schema/migrations/` holds one file per version bump, each exporting
`migrate(store: unknown): NextStore` operating on the **whole store**, not a
single record. On load, read `Meta.schemaVersion`, run every migration up to
current, validate the result, write back, update `Meta`. A fixture of the full
store at every historical version lives in `src/schema/__fixtures__/` and is
migrated in tests.
